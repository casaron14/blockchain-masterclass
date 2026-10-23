# Product Requirements Document: Blockchain Masterclass Booking Website

**Status:** Draft
**Document type:** Internal
**Last updated:** August 30, 2026

## 1. Overview

This document defines the requirements for a booking website for the Blockchain Masterclass, an in-person event to be held in Dar es Salaam, Tanzania. The site's core purpose is to let prospective attendees view event details, book a seat, complete payment, and receive their ticket, with minimal friction.

## 2. Goals

The primary goal of this website is to enable and simplify bookings for the masterclass. A successful launch means attendees can go from landing on the site to holding a confirmed ticket without confusion or support intervention, and the event can reliably fill up to its seat cap through this channel.

*Open question: it would help to define at least one measurable target before launch, for example a target number of completed bookings, or an acceptable payment failure/drop-off rate. This is currently undefined and should be filled in before development starts.*

## 3. Target Audience

The event is aimed at the general public rather than a specialized or crypto-native audience. This has direct implications for design: payment options, instructions, and ticket delivery should be written in plain, non-technical language, including the crypto payment option, since many attendees may not be familiar with how it works.

## 4. Event Details

- **Name:** Blockchain Masterclass
- **Location:** Dar es Salaam, Tanzania (in-person)
- **Date:** Not yet confirmed — the site should support easy updating of the date once set, and this must be finalized before launch
- **Ticket type:** Single ticket type, no tiers
- **Price:** TZS 30,000 per ticket (fixed equivalent of 12 USDT for crypto payments — see Section 7)
- **Capacity:** 300 seats total, no seat selection (general admission)

## 5. Scope

### In scope
- Public-facing homepage with event details
- Language switcher for English and Swahili, available at the top of every page
- Booking flow to reserve a seat by entering attendee details
- Temporary seat hold during payment (60 minutes; see Section 6.3 and Section 9)
- Payment via AzamPesa STK push
- Payment via USDT (BEP20 network), fixed at 12 USDT per ticket
- Automatic ticket delivery via email, including a QR code for entry verification
- A help/support placeholder, visible to attendees who get stuck (see Section 6.4)
- Enforcement of the 300-seat cap, including handling for when the event is sold out
- Retention of client (attendee) data indefinitely — no automated deletion after the event

### Out of scope (assumed — confirm before build)
- Admin dashboard or back-office management tools
- Refunds or cancellations handling
- Multi-event support (site is scoped to this single event)
- User accounts or login
- Seat/table selection
- WhatsApp ticket delivery (removed — see Section 8)
- LipaNamba as a payment method (removed — see Section 6.3)

*These exclusions are assumptions based on the information available. Please confirm or correct before development begins.*

## 6. Functional Requirements by Page

### 6.1 Homepage
- Language switcher (English/Swahili) at the top of the page, persisting the user's choice across the site
- Displays event name, date (or "date to be announced" if unconfirmed), location, and price
- Displays a description of the masterclass and what attendees can expect
- Displays remaining seat availability, or at minimum reflects sold-out status once the cap is reached
- Primary call-to-action to begin booking

### 6.2 Booking Page
- Form to collect attendee details required for the ticket (at minimum: full name, email, phone number)
- Validates that seats remain available before allowing the user to proceed to payment
- Clear indication of the price (TZS 30,000 / 12 USDT) before proceeding
- Once the attendee proceeds to payment, their seat is placed on a temporary hold for 60 minutes (see Section 9)

### 6.3 Payment Page
- Presents two payment options to the user: AzamPesa STK push and USDT (BEP20)
- STK push flow triggers a payment prompt via AzamPesa and waits for confirmation
- USDT (BEP20) flow displays a wallet address (and ideally a QR code) for a fixed amount of 12 USDT, with a confirmation step once the transaction is verified on-chain
- Displays a visible countdown or clear indication of the 60-minute hold window, so the attendee understands the time constraint
- Clear success state once payment is confirmed, with next steps (ticket delivery) explained
- Clear failure/retry state if payment does not go through, or if the hold expires before payment completes

### 6.4 Help / Support
- A placeholder for help/support should be visible on the site (e.g., a persistent link, button, or contact section)
- *Open question: the actual contact method (WhatsApp number, phone, email, live chat) and staffing/response expectations are not yet defined — needs to be decided before this can move beyond a placeholder*

## 7. Payment Integration Details

- **STK Push provider:** AzamPesa, selected for simpler onboarding compared to alternatives
- **Crypto:** USDT on the BEP20 network, priced at a fixed rate of 12 USDT per ticket (not a live-converted exchange rate). Given crypto payments don't confirm instantly the way STK push does, the flow needs a clear "pending confirmation" state so attendees aren't left uncertain whether their booking succeeded, and a process (manual or automated) for verifying the transaction on-chain before releasing the ticket
- *Open question: since the 12 USDT rate is fixed rather than live, is there a process for revisiting/updating this figure if TZS/USDT market rates drift significantly before the event?*

## 8. Ticket Delivery

Once payment is confirmed, the ticket is sent via email. The ticket includes a QR code as well as attendee name, ticket reference/ID, and event details, so it can be scanned to verify entry and prevent duplicate use at the venue.

*Open question: how will venue staff verify the QR code at check-in — a scanning app/device, or another method? This should be decided before development, since it may require a lightweight check-in tool in addition to the booking site itself.*

## 9. Edge Cases and Error Handling

The following scenarios need defined behavior before development starts:

- **Event reaches the 300-seat cap:** the booking page should prevent further bookings and the homepage should reflect sold-out status
- **Seat hold expires:** if an attendee doesn't complete payment within 60 minutes, the hold is marked as expired and the seat becomes available again. Expired holds are not deleted — they remain in the system as records for reporting/troubleshooting purposes
- **Payment fails or times out:** the attendee should be told clearly and given the option to retry, without losing their entered details, provided the hold hasn't already expired
- **Crypto payment underpaid or sent late:** needs a defined resolution process, since blockchain transactions can't be reversed or auto-corrected the way a failed STK push can. This is more likely now that the amount is fixed at 12 USDT rather than dynamically converted
- **Duplicate booking attempts:** whether the same person can book more than once, and how that's detected, needs to be decided
- **Ticket delivery failure:** if the email fails to send, there should be a fallback (e.g., retry, or a way for the attendee to request re-delivery)

## 10. Non-Functional Requirements

- The site should be mobile-responsive, since general public attendees are likely to book primarily from a phone
- The site should be available in English and Swahili, with a switcher accessible from the top of every page
- Given the site handles payment information, it should follow standard practices for secure handling of personal and payment data
- Attendee data is retained indefinitely; no automated deletion process is required, but standard data security practices still apply to stored records
- The site should perform reliably under the expected traffic for up to 300 bookings, including handling a possible rush around ticket sale periods, and correctly handle concurrent seat holds during that rush

## 11. Timeline and Ownership

This is an internal document intended to allow development to begin immediately. No formal launch date has been set yet — the event date is unconfirmed, which also means a final "must launch by" date is still open. This should be established as soon as the event date is locked in, since the booking site needs to be live with enough lead time before the event.

## 12. Open Questions

- What is the measurable success target for the booking flow (e.g., number of bookings, acceptable drop-off rate)?
- What is the confirmed event date?
- What is the actual contact method and staffing plan for the help/support placeholder?
- How will venue staff verify ticket QR codes at check-in — is a scanning tool needed?
- Is there a process for updating the fixed 12 USDT rate if market rates drift before the event?
- How should underpaid or delayed crypto payments be resolved?
- Should duplicate bookings by the same person be prevented, and if so, how?
- Are the remaining items under "out of scope" (Section 5) correct, or should any be added to this version?