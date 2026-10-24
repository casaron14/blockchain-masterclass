// This fallback serves health-independent API paths not handled by one of the
// dedicated route-group functions below api/.
import blockchainMasterclassApiApplication from '../../../backend/app.js';

export const config = {
  // Preserve the existing timeout for fallback routes, including cron requests
  // if Vercel resolves them through this catch-all.
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
