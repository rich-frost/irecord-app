/** ****************************************************************************
 * Location controller.
 *****************************************************************************/
import $ from 'jquery';
import _ from 'lodash';
import Backbone from 'backbone';
import Indicia from 'indicia';
import Log from 'helpers/log';
import Validate from 'helpers/validate';
import StringHelp from 'helpers/string';
import LocHelp from 'helpers/location';
import App from 'app';
import radio from 'radio';

import savedSamples from 'saved_samples';
import appModel from 'app_model';
import TabsLayout from '../../views/tabs_layout';
import HeaderView from './header_view';
import LockView from '../../views/attr_lock_view';
import PastLocationsController from '../../../settings/locations/controller';

import GpsView from './gps_view';
import MapView from './map/map_view';
import GridRefView from './grid_ref_view';
import PastView from './past_view';
import './styles.scss';

const API = {
  show(sampleID, subSampleID, options = {}) {
// wait till savedSamples is fully initialized
    if (savedSamples.fetching) {
      const that = this;
      savedSamples.once('fetching:done', () => {
        API.show.apply(that, [sampleID]);
      });
      return;
    }

    let sample = savedSamples.get(sampleID);

    // Not found
    if (!sample) {
      radio.trigger('app:404:show', { replace: true });
      return;
    }

    // can't edit a saved one - to be removed when sample update
    // is possible on the server
    if (sample.getSyncStatus() === Indicia.SYNCED) {
      radio.trigger('samples:show', sampleID, { replace: true });
      return;
    }

    if (subSampleID) {
      sample = sample.samples.get(subSampleID);
    }

    // MAIN
    const sampleLocation = sample.get('location') || {};

    // pick last used tab
    const active = {};
    if (!sampleLocation.source) {
      active.gps = true;
    } else {
      active[sampleLocation.source] = true;
    }

    const mainView = new TabsLayout({
      tabs: [
        {
          active: active.gps,
          id: 'gps',
          title: '<span class="icon icon-location"></span>',
          ContentView: GpsView,
        },
        {
          active: active.map,
          id: 'map',
          title: '<span class="icon icon-map"></span>',
          ContentView: MapView,
        },
        {
          active: active.gridref,
          id: 'grid-ref',
          title: 'GR',
          ContentView: GridRefView,
        },
        {
          id: 'past',
          title: '<span class="icon icon-clock"></span>',
          ContentView: PastView,
        },
      ],
      model: new Backbone.Model({ sample, appModel }),
      vent: App,
    });

    // past locations
    mainView.on('childview:location:select:past', (location) => {
      API.setLocation(sample, location, true)
        .then(() => {
          API.updateLock(sample.get('location'));
          window.history.back();
        });
    });
    mainView.on('childview:location:delete', (model) => {
      PastLocationsController.deleteLocation(model);
    });
    mainView.on('childview:location:edit', (model) => {
      PastLocationsController.editLocation(model);
    });

    // map
    mainView.on('childview:location:select:map',
      (loc, createNew) => API.setLocation(sample, loc, createNew)
    );

    // gridref
    mainView.on('childview:location:select:gridref',
      data => API.onGridRefSelect(sample, data)
    );

    // gps
    mainView.on('childview:gps:click', () => API.onGPSClick(sample));

    // location name
    mainView.on('childview:location:name:change',
      name => API.updateLocationName(sample, name)
    );

    radio.trigger('app:main', mainView);

    // HEADER
    const lockView = new LockView({
      model: new Backbone.Model({ appModel, sample }),
      attr: 'location',
      onLockClick: API.onLockClick,
    });

    const headerView = new HeaderView({
      onExit: () => {
        API.updateLock(sample.get('location'));
        window.history.back();
      },
      rightPanel: lockView,
      model: sample,
    });

    radio.trigger('app:header', headerView);

    // FOOTER
    radio.trigger('app:footer:hide');
  },

  onLockClick() {
    // invert the lock of the attribute
    // real value will be put on exit
    appModel.setAttrLock(
      'location',
      !appModel.getAttrLock('location', 'general'),
      'general'
    );
  },

  /**
   * Sets new location to sample.
   * @param sample
   * @param loc
   * @param createNew
   */
  setLocation(sample, loc, reset) {
    if (typeof loc !== 'object') {
      // jQuery event object bug fix
      Log('Location:Controller:setLocation: loc is not an object.', 'e');
      return Promise.reject(new Error('Invalid location'));
    }

    let location = loc;
    // we don't need the GPS running and overwriting the selected location
    sample.stopGPS();

    if (!reset) {
      // extend old location to preserve its previous attributes like name or id
      let oldLocation = sample.get('location');
      if (!_.isObject(oldLocation)) oldLocation = {}; // check for locked true
      location = $.extend(oldLocation, location);
    }

    // save to past locations
    const locationID = appModel.setLocation(location);
    location.id = locationID;

    sample.set('location', location);
    sample.trigger('change:location');

    return sample.save()
      .catch((error) => {
        Log(error, 'e');
        radio.trigger('app:dialog:error', error);
      });
  },

  /**
   * Updates the
   * @param sample
   */
  updateLock(location = {}) {
    const currentLock = appModel.getAttrLock('location', 'general');

    // validate
    if ((location.latitude && location.longitude) || location.name) {
      // we can lock location and name on their own
      // don't lock GPS though, because it varies more than a map or gridref

      const locationIsLocked =
              appModel.isAttrLocked('location', location, 'general');

      if (currentLock && (locationIsLocked || currentLock === true)) {
        // update locked value if attr is locked
        // check if previously the value was locked and we are updating
        Log('Updating lock.', 'd');

        if (location.source === 'gps') {
          // on GPS don't lock other than name
          appModel.setAttrLock('location', { name: location.name }, 'general');
          return;
        }

        appModel.setAttrLock('location', location, 'general');
      }
    } else if (currentLock === true) {
      // reset if no location or location name selected but locked is clicked
      appModel.setAttrLock('location', null, 'general');
    }
  },

  onGPSClick(sample) {
    // turn off if running
    if (sample.isGPSRunning()) {
      sample.stopGPS();
    } else {
      sample.startGPS();
    }
  },

  updateLocationName(sample, name) {
    if (!name || typeof name !== 'string') {
      return;
    }

    const location = sample.get('location') || {};
    location.name = StringHelp.escape(name);
    sample.set('location', location);
    sample.trigger('change:location');
    sample.save();
  },

  onGridRefSelect(sample, data) {
    if (!API.validateGridRef(data)) {
      return;
    }

    // get lat/long from new gridref
    const latLon = LocHelp.grid2coord(data.gridref);
    const location = {
      source: 'gridref',
      name: data.name,
      gridref: data.gridref,
      latitude: parseFloat(latLon.lat.toFixed(8)),
      longitude: parseFloat(latLon.lon.toFixed(8)),
    };

    // get accuracy
    // -2 because of gridref letters, 2 because this is min precision
    const accuracy = (data.gridref.replace(/\s/g, '').length - 2) || 2;
    location.accuracy = accuracy;

    API.setLocation(sample, location)
      .then(() => {
        API.updateLock(sample.get('location'));
        window.history.back();
      });
  },

  validateGridRef(data) {
    /**
     * Validates the new location
     * @param attrs
     */
    function validate(attrs) {
      const errors = {};

      if (!attrs.name) {
        errors.name = "can't be blank";
      }

      if (!attrs.gridref) {
        errors.gridref = "can't be blank";
      } else {
        const gridref = attrs.gridref.replace(/\s/g, '');
        if (!Validate.gridRef(gridref)) {
          errors.gridref = 'invalid';
        } else if (!LocHelp.grid2coord(gridref)) {
          errors.gridref = 'invalid';
        }
      }

      if (!_.isEmpty(errors)) {
        return errors;
      }

      return null;
    }

    const validationError = validate(data);
    if (!validationError) {
      radio.trigger('gridref:form:data:invalid', {}); // update form
      return true;
    }

    radio.trigger('gridref:form:data:invalid', validationError);
    return false;
  },
};

export { API as default };
