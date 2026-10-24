import {
  BACK_OFFICE_HOME_URL,
  BOOKING_PAGE_URL,
  EVENT_HOME_URL,
} from './siteRoutes.js';

export function buildNotFoundDestinationLinks() {
  return {
    eventHome: EVENT_HOME_URL,
    bookingLookup: BOOKING_PAGE_URL,
    backOffice: BACK_OFFICE_HOME_URL,
  };
}
