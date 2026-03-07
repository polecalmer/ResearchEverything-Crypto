import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. '
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    try {
      const stripe = await getUncachableStripeClient();
      const event = JSON.parse(payload.toString());

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        if (session.payment_status === 'paid' && session.metadata?.userId) {
          const userId = session.metadata.userId;

          const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ['line_items', 'line_items.data.price.product'],
          });

          const lineItem = fullSession.line_items?.data?.[0];
          const product = lineItem?.price?.product as any;
          const creditsToAdd = parseInt(product?.metadata?.credits || '0', 10);

          if (creditsToAdd > 0) {
            const newBalance = await storage.addCredits(userId, creditsToAdd);
            console.log(`Added ${creditsToAdd} credits to user ${userId}. New balance: ${newBalance}`);
          }
        }
      }
    } catch (error) {
      console.error('Error processing credit fulfillment:', error);
    }
  }
}
