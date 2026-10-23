// One Vercel serverless function serves the whole Express API.
//
// The API project used to be a second Vercel project with its own
// api/[...all].mjs entrypoint. It now ships inside the Next.js deployment:
// every /api/* request reaches this Pages Router API route, which hands the
// Node request and response straight to the same Express application that
// backend/server.js listens with locally. A single function keeps the Vercel
// function count low while the route table, middleware and error handling stay
// exactly where they were.
import blockchainMasterclassApiApplication from '../../../backend/app.js';

export const config = {
  // The cron tick runs every due job sequentially, and a slow RPC endpoint can
  // consume the default budget, so give the function the plan maximum.
  maxDuration: 60,
  api: {
    // Express mounts express.json() (16 kB) and multer (receipt uploads), so
    // Next must not consume the request stream first.
    bodyParser: false,
    // The Express application writes the response itself; Next should not
    // expect this handler to call res.end() through its own wrapper.
    externalResolver: true,
  },
};

export default function forwardApiRequestToExpressApplication(request, response) {
  blockchainMasterclassApiApplication(request, response);
}
