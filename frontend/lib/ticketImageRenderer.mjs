// Server-only ticket artwork. This lives in the Next.js project because
// ImageResponse is a Next.js API (`next/og`) that renders the same JSX tree
// with Satori and resvg on the Node.js runtime.
//
// Satori only supports a subset of CSS. Every container below uses explicit
// inline styles, and every element with more than one child is a flex
// container, which is what keeps the layout deterministic on a phone screen.
//
// The module is .mjs so the standalone Express process can import it without a
// transpiler; Next.js imports the same file during its build.

import React from 'react';
import { ImageResponse } from 'next/og.js';
import QRCode from 'qrcode';

import {
  EVENT_DATE_LABEL,
  EVENT_LOCATION,
  EVENT_TAGLINE,
  EVENT_TITLE,
  PLATFORM_BRAND_NAME,
  PLATFORM_WEBSITE_ADDRESS,
} from '../../shared/eventConfig.js';

export const TICKET_IMAGE_WIDTH = 1200;
export const TICKET_IMAGE_HEIGHT = 630;

const TICKET_PAPER_COLOR = '#F2EDE3';
const TICKET_PAPER_SUNK_COLOR = '#E9E2D5';
const TICKET_INK_COLOR = '#14120E';
const TICKET_COPPER_COLOR = '#A34A25';
const TICKET_SECONDARY_TEXT_COLOR = '#615A4D';
const TICKET_HAIRLINE_COLOR = '#CAC6BD';
const TICKET_MONO_FONT_STACK = "'Courier New', Courier, monospace";
const TICKET_BODY_FONT_STACK = 'Helvetica, Arial, sans-serif';
const TICKET_DEFAULT_TICKET_TYPE_LABEL = 'General Admission';

export function buildTicketCodeForBooking(bookingRecord) {
  const bookingReferenceCode = String(bookingRecord?.ref ?? '').trim().toUpperCase();

  if (!bookingReferenceCode) {
    throw new Error('TICKET_BOOKING_REFERENCE_MISSING');
  }

  return `EVT-${bookingReferenceCode}`;
}

export async function renderBookingCodeQrDataUrl(bookingRecord) {
  const ticketCode = buildTicketCodeForBooking(bookingRecord);

  return QRCode.toDataURL(ticketCode, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 420,
    color: {
      dark: TICKET_INK_COLOR,
      light: TICKET_PAPER_COLOR,
    },
  });
}

function buildTicketDetailItem(detailLabel, detailValue) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        marginRight: 22,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: TICKET_MONO_FONT_STACK,
          fontSize: 11,
          letterSpacing: 2,
          color: TICKET_SECONDARY_TEXT_COLOR,
          marginBottom: 7,
        },
      },
      detailLabel
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: TICKET_BODY_FONT_STACK,
          fontSize: 18,
          fontWeight: 600,
          color: TICKET_INK_COLOR,
          lineHeight: 1.25,
        },
      },
      detailValue
    )
  );
}

export function buildTicketImageElement(bookingRecord, options = {}) {
  const ticketCode = buildTicketCodeForBooking(bookingRecord);
  const attendeeName = String(bookingRecord?.full_name ?? 'Attendee').trim();
  const eventTimeLabel = String(options.eventTimeLabel ?? '').trim();
  const ticketTypeLabel =
    String(options.ticketTypeLabel ?? TICKET_DEFAULT_TICKET_TYPE_LABEL).trim() ||
    TICKET_DEFAULT_TICKET_TYPE_LABEL;

  const attendeeNameFontSize = attendeeName.length > 28 ? 30 : 36;

  const detailItems = [
    buildTicketDetailItem('DATE', EVENT_DATE_LABEL),
    eventTimeLabel ? buildTicketDetailItem('TIME', eventTimeLabel) : null,
    buildTicketDetailItem('VENUE', EVENT_LOCATION),
    buildTicketDetailItem('TICKET TYPE', ticketTypeLabel),
  ].filter(Boolean);

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        backgroundColor: TICKET_PAPER_COLOR,
        color: TICKET_INK_COLOR,
        padding: 48,
        fontFamily: TICKET_BODY_FONT_STACK,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'space-between',
          paddingRight: 40,
          minWidth: 0,
        },
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${TICKET_HAIRLINE_COLOR}`,
            paddingBottom: 16,
          },
        },
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              fontFamily: TICKET_MONO_FONT_STACK,
              fontSize: 13,
              letterSpacing: 3,
              color: TICKET_INK_COLOR,
            },
          },
          PLATFORM_BRAND_NAME.toUpperCase()
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              fontFamily: TICKET_MONO_FONT_STACK,
              fontSize: 12,
              letterSpacing: 2,
              color: TICKET_COPPER_COLOR,
            },
          },
          'ADMIT ONE'
        )
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            paddingTop: 26,
            paddingBottom: 22,
          },
        },
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              fontFamily: TICKET_MONO_FONT_STACK,
              fontSize: 12,
              letterSpacing: 3,
              color: TICKET_COPPER_COLOR,
              marginBottom: 12,
            },
          },
          'EVENT TICKET'
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              fontFamily: TICKET_BODY_FONT_STACK,
              fontSize: 58,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: -1.5,
              marginBottom: 10,
            },
          },
          EVENT_TITLE
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              fontSize: 19,
              lineHeight: 1.4,
              color: TICKET_SECONDARY_TEXT_COLOR,
              marginBottom: 26,
            },
          },
          EVENT_TAGLINE
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: TICKET_PAPER_SUNK_COLOR,
              borderLeft: `3px solid ${TICKET_COPPER_COLOR}`,
              padding: '18px 22px',
            },
          },
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                fontFamily: TICKET_MONO_FONT_STACK,
                fontSize: 11,
                letterSpacing: 2,
                color: TICKET_SECONDARY_TEXT_COLOR,
                marginBottom: 6,
              },
            },
            'ATTENDEE'
          ),
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                fontSize: attendeeNameFontSize,
                fontWeight: 700,
                lineHeight: 1.15,
              },
            },
            attendeeName
          )
        )
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
          },
        },
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'row',
              borderTop: `1px solid ${TICKET_HAIRLINE_COLOR}`,
              paddingTop: 18,
            },
          },
          ...detailItems
        ),
        React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 22,
              paddingTop: 14,
              borderTop: `1px solid ${TICKET_HAIRLINE_COLOR}`,
            },
          },
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                fontFamily: TICKET_MONO_FONT_STACK,
                fontSize: 12,
                letterSpacing: 1.5,
                color: TICKET_INK_COLOR,
              },
            },
            ticketCode
          ),
          React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                fontFamily: TICKET_MONO_FONT_STACK,
                fontSize: 10,
                letterSpacing: 1,
                color: TICKET_SECONDARY_TEXT_COLOR,
              },
            },
            PLATFORM_WEBSITE_ADDRESS.toUpperCase()
          )
        )
      )
    ),
    React.createElement('div', {
      style: {
        display: 'flex',
        width: 1,
        backgroundColor: TICKET_HAIRLINE_COLOR,
        marginTop: 4,
        marginBottom: 4,
      },
    }),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: 340,
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: 40,
        },
      },
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: TICKET_PAPER_COLOR,
            border: `1px solid ${TICKET_HAIRLINE_COLOR}`,
            padding: 18,
          },
        },
        React.createElement('img', {
          src: options.qrDataUrl,
          width: 268,
          height: 268,
          alt: 'Ticket booking code QR',
          style: {
            display: 'flex',
            width: 268,
            height: 268,
          },
        })
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            fontFamily: TICKET_MONO_FONT_STACK,
            fontSize: 11,
            letterSpacing: 3,
            color: TICKET_COPPER_COLOR,
            marginTop: 18,
          },
        },
        'SCAN AT ENTRY'
      ),
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            fontFamily: TICKET_MONO_FONT_STACK,
            fontSize: 13,
            letterSpacing: 2,
            color: TICKET_SECONDARY_TEXT_COLOR,
            marginTop: 8,
          },
        },
        ticketCode
      )
    )
  );
}

export function convertTicketImageResponseToPngBuffer(imageResponse) {
  return imageResponse.arrayBuffer().then((pngArrayBuffer) => Buffer.from(pngArrayBuffer));
}

export async function renderTicketPngBufferForBooking(bookingRecord, options = {}) {
  const qrDataUrl = options.qrDataUrl ?? (await renderBookingCodeQrDataUrl(bookingRecord));
  const imageResponse = new ImageResponse(
    buildTicketImageElement(bookingRecord, { ...options, qrDataUrl }),
    {
      width: TICKET_IMAGE_WIDTH,
      height: TICKET_IMAGE_HEIGHT,
    }
  );

  return convertTicketImageResponseToPngBuffer(imageResponse);
}
