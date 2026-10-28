import ticketRouter from '../../../../backend/routes/ticketRouter.js';
import { createScopedApiApplication } from '../../../../backend/serverlessApiApplication.js';

const ticketApiApplication = createScopedApiApplication('/api/tickets', ticketRouter);

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
  // A redelivery renders the PDF and waits for the email provider.
  maxDuration: 60,
};

export default function forwardTicketApiRequestToExpressRouter(request, response) {
  ticketApiApplication(request, response);
}
