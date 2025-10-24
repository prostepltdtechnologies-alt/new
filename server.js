require('dotenv').config();
const express = require("express");
const app = express();
const { resolve } = require("path");
// This is your test secret API key.
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post("/create_location", async (req, res) => {
  const location = await stripe.terminal.locations.create({
    display_name: 'HQ',
    address: {
      line1: '1272 Valencia Street',
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
      postal_code: '94110',
    }
  });

  res.json(location);
});

app.post("/register_reader", async (req, res) => {
  const reader = await stripe.terminal.readers.create({
    registration_code: 'simulated-s700',
    location: req.body.location_id,
    label: 'Quickstart - S700 Simulated Reader'
  });

  res.json(reader);
});

app.post("/create_payment_intent", async (req, res) => {
  // For Terminal payments, the 'payment_method_types' parameter must include
  // 'card_present'.
  // To automatically capture funds when a charge is authorized,
  // set `capture_method` to `automatic`.
  const intent = await stripe.paymentIntents.create({
    amount: req.body.amount,
    currency: 'usd',
    payment_method_types: [
      'card_present',
    ],
    capture_method: 'automatic',
    payment_method_options: {
      card_present: {
        capture_method: 'manual_preferred'
      }
    }
  });
  res.json(intent);
});

app.post("/process_payment", async (req, res) => {
  var attempt = 0;
  const tries = 3;
  while (true) {
    attempt++;
    try {
      const reader = await stripe.terminal.readers.processPaymentIntent(
        req.body.reader_id,
        {
          payment_intent: req.body.payment_intent_id,
        }
      );
      return res.send(reader);
    } catch (error) {
      console.log(error);
      switch (error.code) {
        case "terminal_reader_timeout":
          // Temporary networking blip, automatically retry a few times.
          if (attempt == tries) {
            return res.send(error);
          }
          break;
        case "terminal_reader_offline":
          // Reader is offline and won't respond to API requests. Make sure the reader is powered on
          // and connected to the internet before retrying.
          return res.send(error);
        case "terminal_reader_busy":
          // Reader is currently busy processing another request, installing updates or changing settings.
          // Remember to disable the pay button in your point-of-sale application while waiting for a
          // reader to respond to an API request.
          return res.send(error);
        case "intent_invalid_state":
          // Check PaymentIntent status because it's not ready to be processed. It might have been already
          // successfully processed or canceled.
          const paymentIntent = await stripe.paymentIntents.retrieve(
            req.body.payment_intent_id
          );
          console.log(
            "PaymentIntent is already in " + paymentIntent.status + " state."
          );
          return res.send(error);
        default:
          return res.send(error);
      }
    }
  }
});

app.post("/simulate_payment", async (req, res) => {
  const reader = await stripe.testHelpers.terminal.readers.presentPaymentMethod(
        req.body.reader_id,
        {
          card_present: {
            number: req.body.card_number,
          },
          type: "card_present",
        }
      );

  res.send(reader);
});

app.post("/capture_payment_intent", async (req, res) => {
  const intent = await stripe.paymentIntents.capture(req.body.payment_intent_id);
  res.send(intent);
});

// Stripe webhook endpoint for live events
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const endpointSecrets = endpointSecret.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Use raw body for signature verification
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecrets);
  } catch (err) {
    console.log('⚠️  Webhook signature verification failed.', err.message);
    return res.sendStatus(400);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);
      break;
    case 'payment_method.attached':
      const paymentMethod = event.data.object;
      console.log('PaymentMethod attached:', paymentMethod.id);
      break;
    case 'payment_intent.payment_failed':
      console.log('PaymentIntent failed:', event.data.object.id);
      break;
    case 'terminal.reader.action_failed':
      console.log('Reader action failed:', event.data.object.id);
      break;
    case 'terminal.reader.updated':
      console.log('Reader updated:', event.data.object.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});


app.listen(4242, () => console.log('Node server listening on port 4242!'));