import { getUncachableStripeClient } from './stripeClient';

async function seedCreditProducts() {
  const stripe = await getUncachableStripeClient();

  const existing = await stripe.products.search({ query: "name:'10 Credits'" });
  if (existing.data.length > 0) {
    console.log('Credit products already exist, skipping seed');
    return;
  }

  const product10 = await stripe.products.create({
    name: '10 Credits',
    description: '10 deal enrichment credits for BookMark',
    metadata: { credits: '10' },
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
    metadata: { credits: '50' },
  });

  await stripe.prices.create({
    product: product50.id,
    unit_amount: 1200,
    currency: 'usd',
  });

  console.log('Created: 50 Credits ($12.00) -', product50.id);
}

seedCreditProducts().then(() => {
  console.log('Done');
  process.exit(0);
}).catch((err) => {
  console.error('Failed to seed credit products:', err);
  process.exit(1);
});
