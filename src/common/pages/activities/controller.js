/** *****************************************************************************
 * Activities List controller.
 ******************************************************************************/
import $ from 'jquery';
import _ from 'lodash';
import Backbone from 'backbone';
import Log from 'helpers/log';
import Analytics from 'helpers/analytics';
import App from 'app';
import radio from 'radio';
import appModel from 'app_model';
import userModel from 'user_model';
import savedSamples from 'saved_samples';
import MainView from './main_view';
import HeaderView from '../../views/header_view';
import RefreshView from './refresh_view';

/**
 * Model to hold details of an activity (group entity)
 */
const ActivityModel = Backbone.Model.extend({
  defaults: {
    id: null,
    title: '',
    description: '',
    group_type: '',
    group_from_date: null,
    group_to_date: null,
    checked: false,
  },
});

let sample; // should be initialized if editing samples' activity

const ActivitiesCollection = Backbone.Collection.extend({
  model: ActivityModel,

  initialize() {
    Log('Activities:Controller: initializing collection.');
    const that = this;

    this.updateActivitiesCollection();

    this.listenTo(userModel, 'sync:activities:start', () => {
      Log('Activities:Controller: reseting collection for sync.');
      that.reset();
    });
    this.listenTo(userModel, 'sync:activities:end', this.updateActivitiesCollection);
  },

  updateActivitiesCollection() {
    Log('Activities:Controller: updating collection.');

    // if loading have empty collection
    if (userModel.synchronizingActivities) {
      this.reset();
      return;
    }

    const that = this;
    const lockedActivity = appModel.getAttrLock('activity');
    let sampleActivity;

    if (sample) {
      sampleActivity = sample.get('group');
    }

    const selectedActivity = sampleActivity || lockedActivity || {};

    // add default activity
    const defaultActivity = new ActivityModel({
      title: 'Default',
      description: '',
      checked: !selectedActivity.id,
    });

    let foundOneToCheck = false;
    this.reset();
    this.add(defaultActivity);

    // add user activities
    const activitiesData = _.cloneDeep(userModel.get('activities'));
    $.each(activitiesData, (index, activ) => {
      activ.checked = selectedActivity.id === activ.id; // todo:  server '71' == local 71
      foundOneToCheck = foundOneToCheck || activ.checked;

      that.add(new ActivityModel(activ));
    });
  },
});

const activitiesCollection = new ActivitiesCollection();

const API = {
  show(sampleID) {
    Log('Activities:Controller: showing.');

    if (!userModel.hasLogIn()) {
      API.userLoginMessage();
    }

    // HEADER
    const refreshView = new RefreshView();

    const headerView = new HeaderView({
      rightPanel: refreshView,
      model: new Backbone.Model({
        title: 'Activities',
      }),
    });

    radio.trigger('app:header', headerView);

    // FOOTER
    radio.trigger('app:footer:hide');

    // MAIN
    const mainView = new MainView({
      collection: activitiesCollection,
    });

    let onExit = () => {
      Log('Activities:List:Controller: exiting.');
      const activity = mainView.getActivity();
      API.save(activity);
    };

    // Initialize data
    if (sampleID) {
      // wait till savedSamples is fully initialized
      if (savedSamples.fetching) {
        const that = this;
        savedSamples.once('fetching:done', () => {
          API.show.apply(that, [sampleID]);
        });
        return;
      }

      sample = savedSamples.get(sampleID);
      activitiesCollection.updateActivitiesCollection();

      onExit = () => {
        Log('Activities:List:Controller: exiting.');
        const newActivity = mainView.getActivity();
        API.save(newActivity);
        sample = null; // reset
      };

      refreshView.on('refreshClick', () => {
        Log('Activities:List:Controller: refresh clicked.');
        if (!userModel.hasLogIn()) {
          radio.trigger('user:login');
          return;
        }
        API.refreshActivities();
      });
    } else {
      activitiesCollection.updateActivitiesCollection();

      refreshView.on('refreshClick', () => {
        Log('Activities:List:Controller: refresh clicked.');
        if (!userModel.hasLogIn()) {
          radio.trigger('user:login');
          return;
        }
        API.refreshActivities();
      });
    }

    // if exit on selection click
    mainView.on('save', onExit);
    radio.trigger('app:main', mainView);

    headerView.onExit = onExit;
  },

  refreshActivities() {
    userModel.syncActivities(true)
      .catch((err) => {
        Log(err, 'e');
        radio.trigger('app:dialog:error', err);
      });
    Analytics.trackEvent('Activities', 'refresh');
  },

  save(activity = {}) {
    const activityID = activity.id;
    if (sample) {
      sample.set('group', userModel.getActivity(activityID));
      sample.save()
        .then(() => window.history.back()) // return to previous page after save
        .catch((err) => {
          Log(err, 'e');
          radio.trigger('app:dialog:error', err);
        });
    } else {
      appModel.setAttrLock('activity', userModel.getActivity(activityID));
      // return to previous page after save
      window.history.back();
    }
  },

  /**
   * Notify the user why the there are no activities.
   */
  userLoginMessage() {
    radio.trigger('app:dialog', {
      title: 'Information',
      body: 'Please log in to the app before selecting an alternative ' +
      'activity for your records.',
      buttons: [{
        id: 'ok',
        title: 'OK',
        onClick: App.regions.getRegion('dialog').hide,
      }],
    });
  },
};

export { API as default };
