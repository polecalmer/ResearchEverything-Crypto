import { getUncachableStripeClient } from './stripeClient';

async function seedCreditProducts() {
  const stripe = await getUncachableStripeClient();

  const existing = await stripe.products.search({ query: "name:'10 Credits'" });
  if (existing.data.length === 0) {
    const product10 = await stripe.products.create({
      name: '10 Credits',
      description: '10 deal enrichment credits for BookMark',
      metadata: { credits: '10', type: 'credits' },
    });

    await stripe.prices.create({
      product: product10.id,
      unit_amount: 300,
      currency: 'usd',
    });

    console.log('Created: 10 Credits ($3.00) -', product10.id);

    const product50 = await stripe.products.create({
      name: '50 Credits',
      description: '50 deal enrichment credits for BookMark — best value',
      metadata: { credits: '50', type: 'credits' },
    });

    await stripe.prices.create({
      product: product50.id,
      unit_amount: 1200,
      currency: 'usd',
    });

    console.log('Created: 50 Credits ($12.00) -', product50.id);
  } else {
    console.log('Credit products already exist, skipping');
  }

  const subExisting = await stripe.products.search({ query: "name:'BookMark Pro Monthly'" });
  if (subExisting.data.length === 0) {
    const monthlyProduct = await stripe.products.create({
      name: 'BookMark Pro Monthly',
      description: 'Monthly subscription — 33 enrichment credits included',
      metadata: { type: 'subscription', credits_per_period: '33' },
    });

    await stripe.prices.create({
      product: monthlyProduct.id,
      unit_amount: 2000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    console.log('Created: BookMark Pro Monthly ($20/mo) -', monthlyProduct.id);

    const yearlyProduct = await stripe.products.create({
      name: 'BookMark Pro Annual',
      description: 'Annual subscription — 33 enrichment credits/month included, save $90/year',
      metadata: { type: 'subscription', credits_per_period: '33' },
    });

    await stripe.prices.create({
      product: yearlyProduct.id,
      unit_amount: 15000,
      currency: 'usd',
      recurring: { interval: 'year' },
    });

    console.log('Created: BookMark Pro Annual ($150/yr) -', yearlyProduct.id);
  } else {
    console.log('Subscription products already exist, skipping');
  }
}

seedCreditProducts().then(() => {
  console.log('Done');
  process.exit(0);
}).catch((err) => {
  console.error('Failed to seed products:', err);
  process.exit(1);
});
