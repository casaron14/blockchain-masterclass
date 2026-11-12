import express from 'express';

import {
  handleAlchemyDepositWebhook,
} from '../controller/alchemyDepositWebhookController.js';

const alchemyWebhookRouter = express.Router();

alchemyWebhookRouter.post('/', handleAlchemyDepositWebhook);

export default alchemyWebhookRouter;
