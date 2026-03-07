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

          if (session.mode === 'subscription') {
            const subscriptionId = session.subscription;
            if (subscriptionId) {
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              const product = await stripe.products.retrieve(sub.items.data[0]?.price?.product as string);
              const creditsPerPeriod = parseInt(product.metadata?.credits_per_period || '0', 10);

              await storage.updateSubscription(userId, {
                subscriptionStatus: sub.status,
                subscriptionId: sub.id,
                subscriptionPeriodEnd: new Date(sub.current_period_end * 1000),
              });

              if (creditsPerPeriod > 0) {
                const newBalance = await storage.addCredits(userId, creditsPerPeriod);
                console.log(`Subscription activated for user ${userId}. Added ${creditsPerPeriod} credits. Balance: ${newBalance}`);
              }
            }
          } else {
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
      }

      if (event.type === 'invoice.paid') {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId && invoice.billing_reason === 'subscription_cycle') {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const product = await stripe.products.retrieve(sub.items.data[0]?.price?.product as string);
          const creditsPerPeriod = parseInt(product.metadata?.credits_per_period || '0', 10);

          const customerId = invoice.customer;
          const user = await storage.getUserByStripeCustomerId(customerId);
          if (user && creditsPerPeriod > 0) {
            await storage.updateSubscription(user.id, {
              subscriptionStatus: sub.status,
              subscriptionId: sub.id,
              subscriptionPeriodEnd: new Date(sub.current_period_end * 1000),
            });
            const newBalance = await storage.addCredits(user.id, creditsPerPeriod);
            console.log(`Subscription renewal for user ${user.id}. Added ${creditsPerPeriod} credits. Balance: ${newBalance}`);
          }
        }
      }

      if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const customerId = sub.customer;
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (user) {
          await storage.updateSubscription(user.id, {
            subscriptionStatus: sub.status,
            subscriptionId: sub.id,
            subscriptionPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          });
          console.log(`Subscription ${event.type} for user ${user.id}. Status: ${sub.status}`);
        }
      }
    } catch (error) {
      console.error('Error processing webhook event:', error);
    }
  }
}
