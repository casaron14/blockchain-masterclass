export const SUPPORTED_LANGUAGES = {
  en: 'EN',
  sw: 'SW',
};

export const DEFAULT_LANGUAGE = 'sw';

export const translations = {
  en: {
    app: {
      home: 'Home',
      bookNow: 'Book now',
    },
    site: {
      nav: {
        home: 'Home',
        programme: 'Programme',
        admission: 'Admission',
        questions: 'Questions',
      },
      hero: {
        titleOne: 'Build the future with',
        titleTwo: 'Blockchain',
        titleLead: 'Build the future',
        titleConnector: 'with',
        subtitle:
          '{name} is a practical learning experience for founders, operators, and curious builders who want to understand how blockchain is changing business and technology.',
        cta: 'Reserve your seat',
        secondary: 'Explore agenda',
        viewProgramme: 'View the programme',
        days: 'Days',
        seats: 'Seats',
        factDate: 'Date',
        factVenue: 'Venue',
        factAdmission: 'Admission',
        format: 'One day · In person',
        sessionFormat: 'Single session day',
        passLabel: 'Admission pass',
        passStub: 'Admit one',
        passSerial: 'Serial',
        raiseCue: 'Raise the next course',
        raisedCue: 'Your ring is raised',
        raisedStep: '04',
        raisedCourse: 'Your seat',
      },
      ledger: {
        label: 'Admission ledger',
        live: 'Live',
        remaining: 'Seats remaining',
        confirmed: '{count} confirmed',
        held: '{count} held',
        open: '{count} open',
        soldOut: 'All {capacity} seats are taken',
        reading: 'Reading the ledger…',
        unavailable: 'Live seat availability is momentarily unavailable.',
      },
      record: {
        heading: 'The academy in numbers',
        note: 'A record of the masterclass series to date.',
      },
      programme: {
        session: 'Session',
      },
      admission: {
        heading: 'Admission',
        regular: 'Regular admission',
        includesHeading: 'Included with your seat',
        includes: [
          'Access to every session on the day',
          'Workshop content and guided exercises',
          'The learning materials shared during the masterclass',
        ],
        reserveNote:
          'Your seat is held for {holdMinutes} minutes while you pay. Payment confirms your place immediately.',
      },
      partner: {
        label: 'Delivered with',
      },
      questions: {
        supportHeading: 'Still need help?',
        supportNote: 'Write to the event team and we will reply before the session.',
      },
      closing: {
        heading: 'Take your seat.',
        body: 'One day of practical teaching. A limited room of 150. Reserve your place in the next minute.',
        meta: '7 November 2026 · Arusha, Tanzania',
      },
      about: {
        sectionTitle: 'About this {name}',
        heading: 'A vibrant space for learners',
        bodyOne:
          'This is a hands-on event built around people who teach from real engagement.',
        bodyTwo:
          'Our mission is to make the Blockchain subject approachable and easily understandable.',
      },
      highlights: {
        title: 'A practical learning experience for ambitious builders',
        intro:
          '{name} brings together real examples, guided teaching, and strategic insight to help you move from curiosity to confident implementation.',
        items: [
          { icon: '01', title: 'Hands-on learning', description: 'Work through real blockchain concepts with step-by-step explanations and practical examples.' },
          { icon: '02', title: 'Expert guidance', description: 'Learn from practitioners who explain the technology in clear, accessible language.' },
          { icon: '03', title: 'Career acceleration', description: 'Understand the opportunities, risks, and decisions that matter in today\'s digital economy.' },
          { icon: '04', title: 'Meaningful networking', description: 'Connect with entrepreneurs, students, and professionals who are building in the same space.' }
        ]
      },
      agenda: {
        title: 'Three focused learning moments',
        intro: 'The day moves from first principles to a working action plan.',
        items: [
          { step: '01', title: 'Foundations', description: 'Learn the building blocks of blockchain, wallets, networks, and how transactions work.' },
          { step: '02', title: 'Use cases', description: 'Explore the most relevant business and product opportunities shaping modern digital systems.' },
          { step: '03', title: 'Action plan', description: 'Leave with a clear understanding of how to evaluate, prototype, and adopt blockchain tools responsibly.' }
        ]
      },
      stats: {
        items: [
          { value: '150', label: 'Participants' },
          { value: '20', label: 'Experts' },
          { value: '10+', label: 'MasterClass' },
          { value: '1', label: 'Day' }
        ]
      },
      sponsors: {
        label: 'Sponsored by',
        items: ['Inkryptus']
      },
      faq: {
        title: 'Questions we hear most often',
        items: [
          { question: 'How do I register for the event?', answer: 'Use the booking button above to reserve your seat. Once your details are submitted, you can continue to payment and receive your confirmation.' },
          { question: 'What is included in the ticket?', answer: 'Your ticket includes access to the event sessions, workshop content, and the learning materials shared during the masterclass.' },
          { question: 'Is the event beginner-friendly?', answer: 'Yes. The session is designed to be practical and approachable for people with little or no prior blockchain experience.' },
          { question: 'Will there be on-site registration?', answer: 'On-site registration is subject to availability. We recommend reserving early to secure your place before the event is full.' }
        ]
      },
      newsletter: {
        sectionTitle: 'Stay Connected',
        message: 'Subscribe for updates on dates, seating and announcements.',
      },
      footer: {
        heading: 'Stay Connected with Us',
        emailLabel: 'Enter Your Email Here *',
        subscribePlaceholder: 'Enter your email here',
        subscribe: 'Subscribe',
        thanks: 'Thanks for subscribing!',
        subscribeCheckbox: 'Yes, subscribe me to your newsletter.',
        contact: 'Contact',
        addressLine1: '{location}',
        addressLine2: '{addressLine2}',
        rights: '© {year} {name}. All rights reserved.',
        powered: 'Powered by',
        organiser: 'Presented by DienAcademy',
        colophon: 'Set in Bodoni Moda, Archivo and DM Mono.',
        legalHeading: 'Legal',
        legal: {
          privacy: 'Privacy Policy',
          terms: 'Terms & Conditions',
        },
      },
    },
    event: {
      date: 'Date: {date}',
      location: 'Location: {location}',
      priceLocal: 'Price: {currency} {price}',
      priceCrypto: 'or {amount} {crypto} ({network})',
    },
    seats: {
      remaining: 'Seats remaining: {count}',
      remainingLabel: 'Seats remaining',
      soldOut: 'Sold out',
      held: '({held} held)',
      filled: '{filled} / {capacity}',
    },
    booking: {
      title: 'Book your seat',
      formHeading: 'Enter your details to reserve a seat',
      attendeeHeading: 'Attendee details',
      summaryHeading: 'Order summary',
      fullName: 'Full name',
      phoneNumber: 'Phone number',
      email: 'Email address',
      paymentMethod: 'Payment method',
      submit: 'Reserve seat',
      creating: 'Reserving seat...',
      holdNote: 'Your seat is held for {holdMinutes} minutes while you pay.',
      resumeTitle: 'You have a seat on hold',
      resumeNote: 'Your previous booking is still active for {minutes} minutes.',
      resumePayment: 'Continue to payment',
      startOver: 'Start over',
      errors: {
        required: '{field} is required',
        invalidEmail: 'Please enter a valid email address',
        invalidPhone: 'Please enter a valid phone number',
        nameTooShort: 'Full name must be at least 2 characters',
        nameTooLong: 'Full name must be 120 characters or fewer',
        soldOut: 'Sorry, the event is sold out.',
        generic: 'Something went wrong. Please try again.',
        turnstileRequired: 'Please complete the security check to continue.',
        turnstileFailed: 'The security check could not be verified. Please try again.',
        turnstileUnavailable:
          'The security check is temporarily unavailable. Please try again in a moment.',
      },
    },
    lookup: {
      title: 'Look up your booking',
      description: 'Enter your booking reference to view your booking status.',
      referenceLabel: 'Booking reference',
      referencePlaceholder: 'e.g. ABC123',
      search: 'Search',
      bookingStatusLabel: 'Booking status',
      paymentStatusLabel: 'Payment status',
      noPayment: 'No payment started',
      downloadTicket: 'Download your ticket',
      ticketDownloaded: 'Ticket downloaded.',
      payNow: 'Continue to payment',
      noActionAvailable: 'This booking has no action available. Contact support for help.',
      bookingStatus: {
        pending: 'Pending',
        confirmed: 'Confirmed',
        cancelled: 'Cancelled',
        expired: 'Expired',
      },
      paymentStatus: {
        initiating: 'Initiating',
        pending: 'Pending',
        confirmed: 'Confirmed',
        failed: 'Failed',
        expired: 'Expired',
      },
      errors: {
        invalidReference: 'Enter a valid booking reference.',
        notFound: 'No booking matches that reference.',
        downloadFailed: 'The ticket could not be downloaded. Please try again.',
        paymentMethodRequired: 'Choose a payment method to continue.',
        soldOut: 'The event is sold out, so this booking cannot be reactivated.',
        cannotPayCurrentStatus: 'This booking can no longer be paid from here.',
        paymentPreparationFailed: 'Payment could not be prepared. Please try again.',
      },
    },
    payment: {
      title: 'Payment',
      timeRemaining: 'Time remaining to pay',
      instantPayment: 'Instant Payment',
      usdt: '{crypto} on {network} (Crypto)',
      comingSoon: 'Coming soon',
      azampesaInstructions:
        'You will receive a prompt on your phone. Approve the payment of {currency} {price}.',
      azampesaPhoneNumber: 'Phone number for the prompt',
      sendStkPrompt: 'Send payment prompt',
      azampesaWaiting: 'Waiting for payment confirmation on your phone...',
      usdtInstructions:
        'Send exactly {amount} {crypto} on {network} to the wallet address below. Your payment is detected automatically.',
      usdtWallet: 'Send to ({network})',
      usdtAmount: 'Amount',
      networkLabel: 'Network: {network}',
      copyAddress: 'Copy address',
      addressCopied: 'Address copied!',
      automaticCheck:
        'Waiting for your transfer to be confirmed automatically. You do not need to enter anything.',
      depositQrAlt: 'QR code with the deposit wallet address',
      lipanamba: 'Lipa Namba (Mobile Money)',
      lipanambaInstructions:
        'Pay {currency} {price} to Lipa Namba {lipaNambaNumber} ({lipaNambaAccountName}), then upload your payment receipt. An admin will review the receipt and email your ticket once payment is confirmed.',
      lipanambaNumberLabel: 'Lipa Namba number',
      lipanambaAccountLabel: 'Account name',
      lipanambaAmountLabel: 'Amount to pay',
      lipanambaReceiptLabel: 'Payment receipt',
      lipanambaReceiptHelp: 'Upload a PDF or photo of the receipt (max 4 MB).',
      lipanambaChooseReceipt: 'Choose receipt file',
      lipanambaUploadReceipt: 'Upload receipt',
      lipanambaUploadingReceipt: 'Uploading receipt...',
      lipanambaReceiptMissing: 'Choose a receipt file before uploading.',
      lipanambaReceiptUploaded:
        'Receipt uploaded. An admin will review it and confirm your payment.',
      lipanambaReceiptAwaitingReview:
        'Your receipt has been received and is awaiting admin review. Your ticket will be emailed after confirmation.',
      lipanambaReceiptRejected:
        'The previous receipt was not accepted. Please upload a clear payment receipt.',
      lipanambaSeatHoldUnavailable:
        'The receipt was received, but the event is currently full so the seat hold could not be extended. Please contact support before paying again.',
      lipanambaReceiptTooLarge: 'The receipt must be 4 MB or smaller.',
      lipanambaReceiptInvalidType: 'Upload a PDF, JPEG, PNG, or WebP receipt.',
      statusPending: 'Payment pending. Waiting for confirmation...',
      statusFailed: 'Payment failed. Please try again.',
      statusExpired: 'Your seat hold has expired. Please book again.',
      expired: 'Your seat hold has expired. Please book again.',
      genericError: 'Payment could not be completed. Please try again.',
    },
    success: {
      title: 'Booking confirmed',
      checkGlyph: '✓',
      message: 'Your seat is secured and your ticket is being prepared.',
      reference: 'Booking reference',
      attendee: 'Attendee',
      ticketNote: 'Your ticket with a QR code has been sent to your email.',
      downloading: 'Preparing your ticket…',
      downloadTicket: 'Download your ticket',
      downloadFailed: 'Ticket download failed. Please try again.',
      supportHeading: 'Need help?',
      supportText: 'Contact the event support team for assistance with your booking.',
      backHome: 'Back to home',
    },
    footerNote: {
      support: 'Support: {email}',
    },
    loadingStates: {
      loadingEvent: 'Preparing the event record…',
      loadingPayment: 'Preparing your payment sheet…',
      loadingQr: 'Drawing the deposit code…',
      loadingWallet: 'Fetching the wallet address…',
      checkingPayment: 'Checking payment status…',
      sendingStkPrompt: 'Sending the prompt…',
      creatingBooking: 'Reserving your seat…',
      searchingBooking: 'Searching the register…',
      preparingPayment: 'Preparing payment…',
      downloadingTicket: 'Preparing your ticket…',
      uploadingReceipt: 'Uploading receipt…',
      subscribing: 'Adding your name…',
      loadingAttendee: 'Reading the attendee record…',
      securityCheck: 'Preparing the security check…',
    },
    notFound: {
      eyebrow: 'Notice of record',
      codeLabel: 'Error 404',
      heading: 'This page is not in the record.',
      body: 'The address you followed does not correspond to a page in this masterclass. The event itself is still open, and the register of bookings is intact.',
      primary: 'Return to the masterclass',
      secondary: 'Find a booking',
      tertiary: 'Back office',
      docketLabel: 'Record check',
      docketSerial: 'Ref. 404',
      requestedAddress: 'Requested address',
      statusLabel: 'Status',
      statusValue: 'Not found',
      eventLabel: 'Event',
      dateLabel: 'Date',
      supportNote: 'If you followed a link from us, write to the event team at',
      sealText: 'DienAcademy',
    },
    loading: 'Loading...',
  },
  sw: {
    app: {
      home: 'Nyumbani',
      bookNow: 'Hifadhi nafasi',
    },
    site: {
      nav: {
        home: 'Nyumbani',
        programme: 'Ratiba',
        admission: 'Kiingilio',
        questions: 'Maswali',
      },
      hero: {
        titleOne: 'Jenga mustakabali kwa',
        titleTwo: 'Blockchain',
        titleLead: 'Jenga mustakabali',
        titleConnector: 'kwa',
        subtitle:
          '{name} ni mafunzo ya vitendo kwa waanzilishi, watendaji, na wanaotaka kujenga uelewa wa jinsi blockchain inavyobadilisha biashara na teknolojia.',
        cta: 'Hifadhi nafasi yako',
        secondary: 'Angalia ratiba',
        viewProgramme: 'Tazama ratiba',
        days: 'Siku',
        seats: 'Nafasi',
        factDate: 'Tarehe',
        factVenue: 'Mahali',
        factAdmission: 'Kiingilio',
        format: 'Siku moja · Ana kwa ana',
        sessionFormat: 'Kipindi cha siku moja',
        passLabel: 'Karatasi ya kiingilio',
        passStub: 'Ingia mtu mmoja',
        passSerial: 'Namba',
        raiseCue: 'Onua kozi inayofuata',
        raisedCue: 'Pete yako imeinuliwa',
        raisedStep: '04',
        raisedCourse: 'Nafasi yako',
      },
      ledger: {
        label: 'Daftari la nafasi',
        live: 'Moja kwa moja',
        remaining: 'Nafasi zilizobaki',
        confirmed: '{count} zimehakikishwa',
        held: '{count} zimehifadhiwa',
        open: '{count} ziko wazi',
        soldOut: 'Nafasi zote {capacity} zimechukuliwa',
        reading: 'Inasoma daftari…',
        unavailable: 'Taarifa ya nafasi haipatikani kwa muda.',
      },
      record: {
        heading: 'Taaluma kwa nambari',
        note: 'Kumbukumbu ya mfululizo wa masterclass hadi sasa.',
      },
      programme: {
        session: 'Kipindi',
      },
      admission: {
        heading: 'Kiingilio',
        regular: 'Kiingilio cha kawaida',
        includesHeading: 'Kinachojumuishwa na nafasi yako',
        includes: [
          'Ufikiaji wa vipindi vyote vya siku',
          'Maudhui ya warsha na mazoezi yanayoongozwa',
          'Nyenzo za kujifunzia zilizoshirikiwa wakati wa masterclass',
        ],
        reserveNote:
          'Nafasi yako inahifadhiwa kwa dakika {holdMinutes} huku ukilipa. Malipo huthibitisha nafasi yako mara moja.',
      },
      partner: {
        label: 'Kwa ushirikiano na',
      },
      questions: {
        supportHeading: 'Bado unahitaji msaada?',
        supportNote: 'Andikia timu ya tukio na tutakujibu kabla ya kipindi.',
      },
      closing: {
        heading: 'Chukua nafasi yako.',
        body: 'Siku moja ya mafunzo ya vitendo. Chumba kidogo cha watu 150. Hifadhi nafasi yako ndani ya dakika ijayo.',
        meta: '7 Novemba 2026 · Arusha, Tanzania',
      },
      highlights: {
        title: 'Mafunzo ya vitendo kwa waanzilishi wenye azma',
        intro:
          '{name} inakuja na mifano halisi, maelekezo ya vitendo, na maarifa ya kimkakati ili kukuwezesha kuhamia kutoka kwa udadisi hadi utekelezaji wa kujitolea.',
        items: [
          { icon: '01', title: 'Mafunzo ya vitendo', description: 'Fanya mazoezi ya dhana za blockchain kwa hatua kwa hatua na mifano ya matumizi ya kweli.' },
          { icon: '02', title: 'Mwongozo wa wataalamu', description: 'Jifunze kutoka kwa watendaji wanaoeleza teknolojia kwa lugha ya wazi na inayofikika.' },
          { icon: '03', title: 'Kuongeza kipato', description: 'Elewa fursa, hatari, na maamuzi yanayoathiri uchumi wa kidijitali wa leo.' },
          { icon: '04', title: 'Mtandao wa maana', description: 'Ungana na wajasiriamali, wanafunzi, na wataalamu wanaofanya kazi katika eneo sawa.' }
        ]
      },
      agenda: {
        title: 'Mifano mitatu ya kujifunza kwa kina',
        intro: 'Siku huanza na misingi na kuishia na mpango wa hatua wa kufanyia kazi.',
        items: [
          { step: '01', title: 'Misingi', description: 'Jifunze misingi ya blockchain, pochi, mitandao, na jinsi miamala inavyofanya kazi.' },
          { step: '02', title: 'Matumizi', description: 'Tambua fursa muhimu za biashara na bidhaa zinazobadilisha mifumo ya leo.' },
          { step: '03', title: 'Mpango wa hatua', description: 'Ondoka na uelewa wa jinsi ya kutathmini, kuunda mfano, na kutumia blockchain kwa uwajibikaji.' }
        ]
      },
      stats: {
        items: [
          { value: '150', label: 'Washiriki' },
          { value: '20', label: 'Wataalamu' },
          { value: '10+', label: 'MasterClass' },
          { value: '1', label: 'Siku' }
        ]
      },
      sponsors: {
        label: 'Imedhaminiwa na',
        items: ['Inkryptus']
      },
      faq: {
        title: 'Maswali tunayoambiwa mara nyingi',
        items: [
          { question: 'Naweza kujisajili vipi kwa tukio?', answer: 'Tumia kitufe cha kuhifadhi nafasi kilicho juu ili kuhifadhi sehemu yako. Baada ya kutuma maelezo yako, utaendelea na malipo na kupokea uthibitisho.' },
          { question: 'Kitu gani kinajumuishwa kwenye tikiti?', answer: 'Tikiti yako inajumuisha ufikiaji wa vipindi vya tukio, mafunzo ya warsha, na nyenzo za kujifunzia zilizoshirikiwa wakati wa masterclass.' },
          { question: 'Je, tukio ni la wanaoanza?', answer: 'Ndiyo. Tukio hili limetengenezwa kuwa la vitendo na la kueleweka kwa watu wenye uelewa mdogo wa blockchain.' },
          { question: 'Je, kutakuwa na usajili kwenye tovuti?', answer: 'Usajili kwenye tovuti unategemea upatikanaji. Tunapendekeza kujiandikisha mapema ili uhakikishe sehemu yako kabla ya tukio kujazwa.' }
        ]
      },
      newsletter: {
        sectionTitle: 'Endelea Kuwa Karibu',
        message: 'Jiandikishe kwa taarifa za tarehe, nafasi na matangazo.',
      },
      footer: {
        heading: 'Kuwa Karibu Nasi',
        emailLabel: 'Weka Barua Pepe Yako Hapa *',
        subscribePlaceholder: 'Weka barua pepe yako hapa',
        subscribe: 'Jiandikishe',
        thanks: 'Asante kwa kujiandikisha!',
        subscribeCheckbox: 'Ndiyo, niandikishe kwa jarida lako.',
        contact: 'Wasiliana',
        addressLine1: '{location}',
        addressLine2: '{addressLine2}',
        rights: '© {year} {name}. Haki zote zimehifadhiwa.',
        powered: 'Inaendeshwa na',
        organiser: 'Inawasilishwa na DienAcademy',
        colophon: 'Imeandaliwa kwa Bodoni Moda, Archivo na DM Mono.',
        legalHeading: 'Sheria',
        legal: {
          privacy: 'Sera ya Faragha',
          terms: 'Masharti na Vigezo',
        },
      },
    },
    event: {
      date: 'Tarehe: {date}',
      location: 'Mahali: {location}',
      priceLocal: 'Bei: {currency} {price}',
      priceCrypto: 'au {amount} {crypto} ({network})',
    },
    seats: {
      remaining: 'Nafasi zilizobaki: {count}',
      remainingLabel: 'Nafasi zilizobaki',
      soldOut: 'Zimeisha',
      held: '({held} zimehifadhiwa)',
      filled: '{filled} / {capacity}',
    },
    booking: {
      title: 'Hifadhi nafasi',
      formHeading: 'Weka maelezo yako ili kuhifadhi nafasi',
      attendeeHeading: 'Maelezo ya mshiriki',
      summaryHeading: 'Muhtasari wa oda',
      fullName: 'Jina kamili',
      phoneNumber: 'Namba ya simu',
      email: 'Barua pepe',
      paymentMethod: 'Njia ya malipo',
      submit: 'Hifadhi nafasi',
      creating: 'Inahifadhi nafasi...',
      holdNote: 'Nafasi yako inahifadhiwa kwa dakika {holdMinutes} huku ukilipa.',
      resumeTitle: 'Una nafasi iliyohifadhiwa',
      resumeNote: 'Booking yako ya awali bado inatumika kwa dakika {minutes}.',
      resumePayment: 'Endelea na malipo',
      startOver: 'Anza upya',
      errors: {
        required: '{field} inahitajika',
        invalidEmail: 'Tafadhali weka barua pepe sahihi',
        invalidPhone: 'Tafadhali weka namba sahihi ya simu',
        nameTooShort: 'Jina lazima liwe na angalau herufi 2',
        nameTooLong: 'Jina lazima lisiwe zaidi ya herufi 120',
        soldOut: 'Samahani, tikiti zimeisha.',
        generic: 'Kuna tatizo. Tafadhali jaribu tena.',
        turnstileRequired: 'Tafadhali kamilisha ukaguzi wa usalama ili kuendelea.',
        turnstileFailed: 'Ukaguzi wa usalama haukuweza kuthibitishwa. Tafadhali jaribu tena.',
        turnstileUnavailable:
          'Ukaguzi wa usalama haupatikani kwa muda. Tafadhali jaribu tena baadaye.',
      },
    },
    lookup: {
      title: 'Tafuta booking yako',
      description: 'Weka namba ya kumbukumbu ya booking yako kuona hali yake.',
      referenceLabel: 'Namba ya kumbukumbu',
      referencePlaceholder: 'mf. ABC123',
      search: 'Tafuta',
      bookingStatusLabel: 'Hali ya booking',
      paymentStatusLabel: 'Hali ya malipo',
      noPayment: 'Malipo hayajaanza',
      downloadTicket: 'Pakua tikiti yako',
      ticketDownloaded: 'Tikiti imepakuliwa.',
      payNow: 'Endelea na malipo',
      noActionAvailable:
        'Booking hii haina hatua inayopatikana. Wasiliana na timu ya usaidizi.',
      bookingStatus: {
        pending: 'Inasubiri',
        confirmed: 'Imethibitishwa',
        cancelled: 'Imeghairiwa',
        expired: 'Imeisha',
      },
      paymentStatus: {
        initiating: 'Inaanzishwa',
        pending: 'Inasubiri',
        confirmed: 'Imethibitishwa',
        failed: 'Imeshindikana',
        expired: 'Imeisha',
      },
      errors: {
        invalidReference: 'Weka namba sahihi ya kumbukumbu ya booking.',
        notFound: 'Hakuna booking inayolingana na namba hiyo.',
        downloadFailed: 'Tikiti haikuweza kupakuliwa. Tafadhali jaribu tena.',
        paymentMethodRequired: 'Chagua njia ya malipo ili kuendelea.',
        soldOut: 'Tukio limejaa, hivyo booking hii haiwezi kufufuliwa.',
        cannotPayCurrentStatus: 'Booking hii haiwezi kulipwa tena kutoka hapa.',
        paymentPreparationFailed: 'Malipo hayakuweza kutayarishwa. Tafadhali jaribu tena.',
      },
    },
    payment: {
      title: 'Malipo',
      timeRemaining: 'Muda uliobaki wa kulipa',
      instantPayment: 'Malipo ya Papo Hapo',
      usdt: '{crypto} kwenye {network} (Crypto)',
      comingSoon: 'Inakuja hivi karibuni',
      azampesaInstructions:
        'Utapokea taarifa kwenye simu yako. Idhibitisha malipo ya {currency} {price}.',
      azampesaPhoneNumber: 'Namba ya simu kwa taarifa ya malipo',
      sendStkPrompt: 'Tuma taarifa ya malipo',
      azampesaWaiting: 'Inasubiri uthibitisho wa malipo kwenye simu yako...',
      usdtInstructions:
        'Tuma {amount} {crypto} kupitia Network ya {network}.',
      usdtWallet: 'Tuma kwenda ({network})',
      usdtAmount: 'Kiasi',
      networkLabel: 'Network: {network}',
      copyAddress: 'Nakili anwani',
      addressCopied: 'Anwani imenakiliwa!',
      automaticCheck:
        'Inasubiri uhamisho wako uthibitishwe moja kwa moja. Huhitaji kuweka chochote.',
      depositQrAlt: 'QR code yenye anwani ya pochi ya malipo',
      lipanamba: 'Lipa Namba (Malipo kwa Simu)',
      lipanambaInstructions:
        'Lipa {price} {currency} kwa Lipa Namba {lipaNambaNumber} ({lipaNambaAccountName}), kisha upload risiti ya malipo. Admin atakagua risiti na akithibitisha malipo utatumiwa tikiti kwa barua pepe.',
      lipanambaNumberLabel: 'Namba ya Lipa Namba',
      lipanambaAccountLabel: 'Jina la akaunti',
      lipanambaAmountLabel: 'Kiasi cha kulipa',
      lipanambaReceiptLabel: 'Risiti ya malipo',
      lipanambaReceiptHelp: 'Upload PDF au picha ya risiti (isizidi 4 MB).',
      lipanambaChooseReceipt: 'Chagua faili ya risiti',
      lipanambaUploadReceipt: 'Upload risiti',
      lipanambaUploadingReceipt: 'Ina-upload risiti...',
      lipanambaReceiptMissing: 'Chagua faili ya risiti kabla ya upload.',
      lipanambaReceiptUploaded:
        'Risiti imeuploadwa. Admin atakagua na kuthibitisha malipo yako.',
      lipanambaReceiptAwaitingReview:
        'Risiti yako imepokelewa na inasubiri ukaguzi wa admin. Tikiti yako itatumwa kwa barua pepe baada ya uthibitisho.',
      lipanambaReceiptRejected:
        'Risiti ya awali haikukubaliwa. Tafadhali upload risiti iliyo wazi ya malipo.',
      lipanambaSeatHoldUnavailable:
        'Risiti imepokelewa, lakini tukio limejaa kwa sasa hivyo nafasi yako haikuweza kuhifadhiwa kwa ukaguzi. Tafadhali wasiliana na timu ya usaidizi kabla ya kulipa tena.',
      lipanambaReceiptTooLarge: 'Risiti isizidi 4 MB.',
      lipanambaReceiptInvalidType: 'Upload risiti ya PDF, JPEG, PNG, au WebP.',
      statusPending: 'Malipo yanasubiri. Inasubiri uthibitisho...',
      statusFailed: 'Malipo yameshindikana. Tafadhali jaribu tena.',
      statusExpired: 'Nafasi yako imeisha. Tafadhali book tena.',
      expired: 'Nafasi yako imeisha. Tafadhali book tena.',
      genericError: 'Malipo hayakukamilika. Tafadhali jaribu tena.',
    },
    success: {
      title: 'Booking imethibitishwa',
      checkGlyph: '✓',
      message: 'Nafasi yako imehifadhiwa na tikiti yako inatayarishwa.',
      reference: 'Namba ya kumbukumbu',
      attendee: 'Mshiriki',
      downloading: 'Inatayarisha tikiti yako…',
      downloadTicket: 'Pakua tikiti yako',
      downloadFailed: 'Imeshindikana kupakua tikiti. Tafadhali jaribu tena.',
      ticketNote: 'Tikiti yako yenye QR code imetumwa kwa barua pepe yako.',
      supportHeading: 'Unahitaji msaada?',
      supportText: 'Wasiliana na timu ya usaidizi kuhusu booking yako.',
      backHome: 'Rudi nyumbani',
    },
    footerNote: {
      support: 'Msaada: {email}',
    },
    loadingStates: {
      loadingEvent: 'Inatayarisha taarifa za tukio…',
      loadingPayment: 'Inatayarisha karatasi ya malipo…',
      loadingQr: 'Inachora msimbo wa amana…',
      loadingWallet: 'Inapata anwani ya pochi…',
      checkingPayment: 'Inakagua hali ya malipo…',
      sendingStkPrompt: 'Inatuma taarifa…',
      creatingBooking: 'Inahifadhi nafasi yako…',
      searchingBooking: 'Inatafuta kwenye daftari…',
      preparingPayment: 'Inaandaa malipo…',
      downloadingTicket: 'Inatayarisha tikiti yako…',
      uploadingReceipt: 'Ina-upload risiti…',
      subscribing: 'Inaongeza jina lako…',
      loadingAttendee: 'Inasoma taarifa ya mshiriki…',
      securityCheck: 'Inaandaa ukaguzi wa usalama…',
    },
    notFound: {
      eyebrow: 'Notisi ya kumbukumbu',
      codeLabel: 'Hitilafu 404',
      heading: 'Ukurasa huu haupo kwenye kumbukumbu.',
      body: 'Anwani uliyofuata haihusiani na ukurasa wa darasa hili. Tukio lenyewe bado liko wazi, na daftari la nafasi liko salama.',
      primary: 'Rudi kwenye darasa',
      secondary: 'Tafuta nafasi',
      tertiary: 'Utawala',
      docketLabel: 'Ukaguzi wa kumbukumbu',
      docketSerial: 'Kumb. 404',
      requestedAddress: 'Anwani iliyoombwa',
      statusLabel: 'Hali',
      statusValue: 'Haipo',
      eventLabel: 'Tukio',
      dateLabel: 'Tarehe',
      supportNote: 'Ikiwa ulifuata kiungo kutoka kwetu, andikia timu ya tukio kwa',
      sealText: 'DienAcademy',
    },
    loading: 'Inapakia...',
  },
};

export function getTranslation(language, key) {
  const keys = key.split('.');
  let value = translations[language] ?? translations[DEFAULT_LANGUAGE];
  for (const part of keys) {
    value = value?.[part];
  }
  return value ?? key;
}

export function translate(language, key, params = {}) {
  let template = getTranslation(language, key);
  for (const [placeholder, replacement] of Object.entries(params)) {
    template = template.replace(`{${placeholder}}`, replacement);
  }
  return template;
}
