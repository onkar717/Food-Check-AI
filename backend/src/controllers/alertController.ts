import { Request, Response } from 'express';
import twilio from 'twilio';
import { RescueRequest } from '../models/RescueRequest';
import mongoose from 'mongoose';

const getClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return twilio(accountSid, authToken);
};

const formatWhatsAppNumber = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  const withCountry = digits.startsWith('91') || digits.startsWith('1')
    ? digits
    : `91${digits}`;
  return `whatsapp:+${withCountry}`;
};

export const sendSpoilageAlert = async (req: Request, res: Response) => {
  try {
    const { phone, detections } = req.body;

    if (!phone || !detections || detections.length === 0) {
      return res.status(400).json({ message: 'phone and detections required' });
    }

    const rottenItems = detections.filter((d: any) =>
      d.prediction?.includes('rotten') || d.prediction?.includes('spoiled')
    );

    if (rottenItems.length === 0) {
      return res.json({ message: 'No rotten items — no alert sent', alertSent: false });
    }

    // Build WhatsApp message
    const itemsList = rottenItems
      .map((d: any) => `• ${d.fruit || d.class || 'item'} (spoilage: ${Math.round((d.spoilage_score || d.confidence || 0) * 100)}%)`)
      .join('\n');

    const message =
      `🚨 *Food Check AI Spoilage Alert*\n\n` +
      `Rotten items detected:\n${itemsList}\n\n` +
      `*Recommended Actions:*\n` +
      `• Isolate affected items immediately\n` +
      `• Trigger rescue cascade for nearby items\n` +
      `• Contact food bank for donation pickup\n\n` +
      `Login to Food Check AI dashboard for full details.`;

    // Create rescue requests for rotten items
    const demoStoreId = new mongoose.Types.ObjectId('65f1a1a1a1a1a1a1a1a1a1a1');
    const rescueRequests = await Promise.all(
      rottenItems.map(async (item: any) => {
        const rr = new RescueRequest({
          products: [],
          storeId: demoStoreId,
          rescueType: 'food-bank-alert',
          rescueCascadeStage: 3,
          daysUntilExpiration: 1,
          status: 'pending',
          totalWeight: 1,
          totalValue: 0,
          environmentalImpact: 2.5,
          notes: `Auto-detected: ${item.fruit || item.class} — spoilage ${Math.round((item.spoilage_score || 0) * 100)}%`,
        });
        return rr.save();
      })
    );

    // Send WhatsApp
    let whatsappSent = false;
    let whatsappError = '';
    const client = getClient();

    if (client) {
      try {
        const toNumber = formatWhatsAppNumber(phone);
        const from = process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886';
        await client.messages.create({
          from,
          to: toNumber,
          body: message,
        });
        whatsappSent = true;
      } catch (err: any) {
        whatsappError = err.message;
        console.error('Twilio error:', err.message);
      }
    } else {
      whatsappError = 'Twilio credentials not configured';
    }

    res.json({
      alertSent: true,
      whatsappSent,
      whatsappError: whatsappError || undefined,
      rescueRequestsCreated: rescueRequests.length,
      rescueRequestIds: rescueRequests.map(r => r._id),
      rottenItemsCount: rottenItems.length,
      message: whatsappSent
        ? `WhatsApp alert sent to ${phone}`
        : `Rescue requests created (WhatsApp: ${whatsappError})`,
    });
  } catch (error: any) {
    console.error('Alert error:', error);
    res.status(500).json({ message: 'Alert failed', error: error.message });
  }
};
