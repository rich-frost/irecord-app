/** ****************************************************************************
 * User model describing the user model on backend. Persistent.
 **************************************************************************** */
import { useContext } from 'react';
import { observable } from 'mobx';
import { z, object } from 'zod';
import {
  DrupalUserModel,
  device,
  useToast,
  useLoader,
  useAlert,
  DrupalUserModelAttrs,
} from '@flumens';
import { NavContext } from '@ionic/react';
import * as Sentry from '@sentry/browser';
import CONFIG from 'common/config';
import { genericStore } from '../store';
import activitiesExt from './activitiesExt';

export interface Attrs extends DrupalUserModelAttrs {
  firstName?: string;
  lastName?: string;
  email?: string;

  statistics: any;

  activities: any[];

  /**
   * @deprecated
   */
  password?: any;
}

const defaults: Attrs = {
  firstName: '',
  lastName: '',
  email: '',

  statistics: null,

  activities: [],
};

export class UserModel extends DrupalUserModel {
  hasActivityExpired: any; // from extension

  getActivity: any; // from extension

  syncActivities: any; // from extension

  activities: any; // from extension

  // eslint-disable-next-line
  // @ts-ignore
  attrs: Attrs = DrupalUserModel.extendAttrs(this.attrs, defaults);

  static registerSchema: any = object({
    email: z.string().email('Please fill in'),
    password: z.string().min(1, 'Please fill in'),
    firstName: z.string().min(1, 'Please fill in'),
    secondName: z.string().min(1, 'Please fill in'),
  });

  static resetSchema: any = object({
    email: z.string().email('Please fill in'),
  });

  static loginSchema: any = object({
    email: z.string().email('Please fill in'),
    password: z.string().min(1, 'Please fill in'),
  });

  uploadCounter = observable({ count: 0 });

  refreshUploadCountStat?: any; // from extension

  getAchievedStatsMilestone?: any; // from extension

  constructor(options: any) {
    super(options);
    Object.assign(this, activitiesExt);

    const checkForValidation = () => {
      if (this.isLoggedIn() && !this.attrs.verified) {
        console.log('User: refreshing profile for validation');
        this.refreshProfile();
      }
    };
    this.ready?.then(checkForValidation);
  }

  async logIn(email: string, password: string) {
    await super.logIn(email, password);

    if (this.id) Sentry.setUser({ id: this.id });
  }

  getPrettyName() {
    return this.isLoggedIn()
      ? `${this.attrs.firstName} ${this.attrs.lastName}`
      : '';
  }

  async checkActivation() {
    if (!this.isLoggedIn()) return false;

    if (!this.attrs.verified) {
      try {
        await this.refreshProfile();
      } catch (e) {
        // do nothing
      }

      if (!this.attrs.verified) return false;
    }

    return true;
  }

  async resendVerificationEmail() {
    if (!this.isLoggedIn() || this.attrs.verified) return false;

    await this._sendVerificationEmail();

    return true;
  }

  resetDefaults() {
    this.uploadCounter.count = 0;

    return super.resetDefaults(defaults);
  }
}

const userModel = new UserModel({
  cid: 'user',
  store: genericStore,
  config: CONFIG.backend,
});

export const useUserStatusCheck = () => {
  const { navigate } = useContext(NavContext);
  const toast = useToast();
  const loader = useLoader();
  const alert = useAlert();

  const check = async () => {
    if (!device.isOnline) {
      toast.warn('Looks like you are offline!');
      return false;
    }

    if (!userModel.isLoggedIn()) {
      navigate(`/user/login`);
      return false;
    }

    if (!userModel.attrs.verified) {
      await loader.show('Please wait...');
      const isVerified = await userModel.checkActivation();
      loader.hide();

      if (!isVerified) {
        const resendVerificationEmail = async () => {
          await loader.show('Please wait...');
          try {
            await userModel.resendVerificationEmail();
            toast.success(
              'A new verification email was successfully sent now. If you did not receive the email, then check your Spam or Junk email folders.'
            );
          } catch (err: any) {
            toast.error(err);
          }
          loader.hide();
        };

        alert({
          header: "Looks like your email hasn't been verified yet.",
          message: 'Should we resend the verification email?',
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
            },
            {
              text: 'Resend',
              handler: resendVerificationEmail,
            },
          ],
        });

        return false;
      }
    }

    return true;
  };

  return check;
};

export default userModel;
