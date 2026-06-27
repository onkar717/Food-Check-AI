import { Router } from 'express';
import { sendSpoilageAlert } from '../controllers/alertController';

const router = Router();

router.post('/spoilage', sendSpoilageAlert);

export default router;
