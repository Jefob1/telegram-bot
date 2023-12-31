const express = require("express");
const bodyParser = require("body-parser");
const expressApp = express();
const accountSid = "AC8785d4cc3ad53df76ba03b24207330c4";
const authToken = "2ff95c0dd45485b4f08f4e5d1e3f8289";
const twilioClient = require("twilio")(accountSid, authToken);
const axios = require("axios");
const paystack = require("paystack")(process.env.stackSecretKey);
const paystackCallbackUrl =
  "https://stash-telegram-bot.onrender.com/paystack-callback";
expressApp.use(express.static("static"));
expressApp.use(bodyParser.json());
const port = 3000;
require("dotenv").config();
const {Telegraf, Markup, session} = require("telegraf");

const bot = new Telegraf(process.env.botToken);
const webhookUrl = "https://stash-telegram-bot.onrender.com";
bot.telegram.setWebhook(`${webhookUrl}/secret-path`);
expressApp.use(bot.webhookCallback("/secret-path"));

bot.use(session());

const products = [
  {
    id: 1,
    name: "Stash Bag",
    price: 5000,
    description: "This will keep you away from us for awhile",
  },
  {
    id: 2,
    name: "Stash Large",
    price: 3000,
    description: "The more the merrier",
  },
  {id: 3, name: "Stash Small", price: 1000, description: "Going solo?"},
];

const commands = [
  {command: "/start", description: "Start the bot"},
  {command: "/help", description: "Show available commands"},
  {command: "/cart", description: "View your cart"},
  {command: "/remove", description: "Remove selected product"},
  {command: "/checkout", description: "Proceed to checkout"},
];

bot.start((ctx) => {
  ctx.session = {cart: [], selectedProduct: null, orderDetails: null};
  const keyboard = Markup.inlineKeyboard(
    products.map((product) => [
      Markup.button.callback(
        `${product.name} - N${product.price}`,
        `selectProduct_${product.id}`
      ),
    ])
  );

  const commandsMessage = commands
    .map((cmd) => `${cmd.command} - ${cmd.description}`)
    .join("\n");
  ctx.reply(
    `Welcome to StashPot Ng!\n\nAvailable commands:\n${commandsMessage}`,
    keyboard
  );
});

bot.action(/^selectProduct_(\d+)$/, (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const selectedProduct = products.find((product) => product.id === productId);
  if (selectedProduct) {
    ctx.session.selectedProduct = selectedProduct;
    ctx.reply(
      `You selected ${selectedProduct.name} - N${selectedProduct.price}. How many?: `
    );
  }
});

bot.on("text", (ctx) => {
  const messageText = ctx.message.text;
  ctx.session = ctx.session || {};
  ctx.session.cart = ctx.session.cart || [];
  const selectedProduct = ctx.session.selectedProduct;
  const orderDetails = ctx.session.orderDetails;

  if (selectedProduct) {
    const quantity = parseInt(messageText);
    if (!isNaN(quantity) && quantity > 0) {
      const productWithQuantity = {product: selectedProduct, quantity};
      ctx.session.cart.push(productWithQuantity);
      ctx.reply(`${quantity} ${selectedProduct.name}(s) added to ${"/cart"}.`);
      ctx.session.selectedProduct = null;
    } else {
      ctx.reply("How many (in digits)? Please try again.");
    }
  } else if (orderDetails) {
    const inputFields = ["email", "phone", "address"];
    const fieldName = inputFields.find((field) => !orderDetails[field]);
    if (fieldName) {
      const userInput = messageText.trim();
      if (fieldName === "email" && !validateEmail(userInput)) {
        ctx.reply("Please enter a valid email address.");
      } else if (fieldName === "phone" && !validatePhoneNumber(userInput)) {
        ctx.reply("Please enter a valid phone number.");
      } else if (fieldName === "address" && userInput.length === 0) {
        ctx.reply("Invalid address. Please enter a valid address.");
      } else {
        orderDetails[fieldName] = userInput;
        if (fieldName === "address") {
          processPayment(ctx, orderDetails);
          ctx.reply("Payment processing...");
        } else {
          ctx.reply(`Please confirm your ${fieldName}:`);
        }
      }
    }
  } else {
    switch (messageText) {
      case "/remove":
        removeCommand(ctx);
        break;
      case "/cart":
        cartCommand(ctx);
        break;
      case "/checkout":
        checkoutCommand(ctx);
        break;
      case "/help":
        helpCommand(ctx);
        break;
      default:
        ctx.reply("Invalid command. Please try again.");
        break;
    }
  }
});

function removeCommand(ctx) {
  const cart = ctx.session.cart;
  if (cart.length > 0) {
    const keyboard = Markup.inlineKeyboard(
      cart.map((productWithQuantity, index) => [
        Markup.button.callback(
          `${productWithQuantity.product.name} - Qty: ${productWithQuantity.quantity}`,
          `removeProduct_${index}`
        ),
      ])
    );
    ctx.reply("Select a product to remove: ", keyboard);
  } else {
    ctx.reply("Your cart is empty 🤨");
  }
}

bot.action(/^removeProduct_(\d+)$/, (ctx) => {
  const productIndex = parseInt(ctx.match[1]);
  const cart = ctx.session.cart;
  if (!isNaN(productIndex) && productIndex >= 0 && productIndex < cart.length) {
    const removedProduct = cart.splice(productIndex, 1)[0];
    ctx.reply(`You removed ${removedProduct.product.name} from your cart.`);
  }
});

function cartCommand(ctx) {
  const cart = ctx.session.cart;
  if (cart.length > 0) {
    const message = cart
      .map(
        (productWithQuantity) =>
          `${productWithQuantity.product.name} - Qty: ${productWithQuantity.quantity}`
      )
      .join("\n");
    ctx.reply(`Your Cart:\n${message}`);
  } else {
    ctx.reply("Your cart is empty. Select products first.");
  }
}

async function checkoutCommand(ctx) {
  const cart = ctx.session.cart;
  const orderDetails = ctx.session.orderDetails || {};

  if (cart.length > 0) {
    const totalPrice = cart.reduce(
      (total, productWithQuantity) =>
        total +
        productWithQuantity.product.price * productWithQuantity.quantity,
      0
    );
    const message = cart
      .map(
        (productWithQuantity) =>
          `${productWithQuantity.product.name} - Qty: ${
            productWithQuantity.quantity
          } - N${(
            productWithQuantity.product.price * productWithQuantity.quantity
          ).toFixed(2)}`
      )
      .join("\n");
    const totalPriceMessage = `\nTotal Price: N${totalPrice.toFixed(2)}`;
    orderDetails.products = cart;
    orderDetails.totalPrice = totalPrice;

    ctx.session.orderDetails = orderDetails;

    ctx.reply(`Selected Products:\n${message}${totalPriceMessage}.`);
    ctx.reply("Please enter your email address:");
  } else {
    ctx.reply("Your cart is empty. Select products first.");
  }
}

function validateEmail(email) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

function validatePhoneNumber(phone) {
  const phonePattern = /^\d{11}$/;
  return phonePattern.test(phone);
}

async function processPayment(ctx, orderDetails) {
  const paystackSecretKey = process.env.stackSecretKey;
  const email = orderDetails.email;
  const amount = orderDetails.totalPrice * 100;

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {email, amount, callback_url: paystackCallbackUrl},
      {
        headers: {
          Authorization: `Bearer ${paystackSecretKey}`,
          "Content-type": "application/json",
        },
      }
    );
    const {authorization_url, access_code} = response.data.data;
    orderDetails.paystackAccessCode = access_code;
    ctx.reply(
      "Please complete the payment by clicking this link: " + authorization_url
    );
  } catch (error) {
    console.error("Paystack API error:", error.message);
    ctx.reply("An error occurred while processing payment. Please try again.");
  }
}

expressApp.get("/paystack-callback", async (req, res) => {
  const {reference} = req.query;

  if (!reference) {
    return res.status(400).send("Invalid request. Missing reference.");
  }
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.stackSecretKey}`,
        },
      }
    );
    const {data} = response.data;
    const amountPaid = data.amount / 100;
    const orderStatus = data.status;
    const orderDetails = req.session.orderDetails;

    if (!orderDetails) {
      return res.status(400).send("Order details not found.");
    }
    if (orderStatus !== "success") {
      return res.status(400).send("Payment failed. Please try again.");
    }
    if (orderDetails.totalPrice !== amountPaid) {
      return res
        .send(400)
        .send("Payment amount does not match. Please contact support.");
    }

    await sendOrderDetailsViaWhatsApp(orderDetails);
    req.session.orderDetails = null;
    console.log(`Payment of N${amountPaid.toFixed(2)} was successful.`);
    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack verification error:", error.message);

    if (error.response && error.response.status === 404) {
      return res.status(404).send("Payment reference not found.");
    }
    if (error.response && error.response.data) {
      const errorMessage = error.response.data.message;
      return res.status(500).send(`Error verifying payment: ${errorMessage}`);
    }
    return res.status(500).send("An error occurred while verifying payment.");
  }
});

expressApp.get("/payment-success", (req, res) => {
  const botLink = "https://t.me/stashng_bot";
  res.send(
    `Payment successful! Click on this link to return to the Bot: <a href="${botLink}">Continue to Telegram Bot</a>`
  );
});

expressApp.get("/payment-verification-failure", async (req, res) => {
  const orderDetails = req.session.orderDetails;

  if (!orderDetails) {
    return res.status(400).send("Order details not found");
  }
  try {
    await sendOrderDetailsViaWhatsApp(orderDetails, res);
    req.session.orderDetails = null;
    res.send(
      "Payment was successful, but we encountered an issue while verifying it. However, your order details have been received."
    );
  } catch (error) {
    console.error("Error sending order details via WhatsApp:", error);
    res
      .status(500)
      .send("An error occurred while sending order details to WhatsApp.");
  }
});

expressApp.post("/paystack-callback", async (req, res) => {
  const {data} = req.body;
  const amountPaid = data.amount / 100;
  const orderStatus = data.status;
  const orderDetails = req.session.orderDetails;

  if (!orderDetails) {
    return res.status(400).send("Order details not found");
  }
  if (orderStatus !== "success") {
    return res.redirect("/payment-verification-failure");
  }
  if (orderDetails.totalPrice !== amountPaid) {
    return res
      .status(400)
      .send("Payment amount does not match. PLease contact support.");
  }
  try {
    await sendOrderDetailsViaWhatsApp(orderDetails);
    req.session.orderDetails = null;
    console.log(`Pyment of N${amountPaid.toFixed(2)} was successful.`);
    return res.redirect("/payment-success");
  } catch (error) {
    console.error("Paysack verification error:", error.message);
    res.redirect("/payment-verification-error");
  }
});

async function sendOrderDetailsViaWhatsApp(orderDetails, res) {
  const cart = orderDetails.products;
  const totalPrice = orderDetails.totalPrice.toFixed(2);

  const orderMessage = cart
    .map(
      (productWithQuantity) =>
        `${productWithQuantity.product.name} - Qty: ${
          productWithQuantity.quantity
        } - N${(
          productWithQuantity.product.price * productWithQuantity.quantity
        ).toFixed(2)}`
    )
    .join("\n");
  const totalPriceMessage = `\nTotal Price: N${totalPrice}`;
  const message = `Order Details:\n${orderMessage}${totalPriceMessage}`;

  try {
    await twilioClient.messages.create({
      body: message,
      from: "whatsapp:+14155238886",
      to: "whatsapp:+2349150697972",
    });
    console.log("Order details sent via WhatsApp.");
    res.send(200);
  } catch (error) {
    console.error("Error sending details via WhatsApp:", error);
    res
      .status(500)
      .send("An error occurred while sending order details to WhatsApp.");
  }
}

function helpCommand(ctx) {
  const keyboard = Markup.inlineKeyboard(
    commands.map((cmd) => [
      Markup.button.callback(cmd.command, `showCommand_${cmd.command}`),
    ])
  );
  ctx.reply("Available commands:", keyboard);
}

bot.action(/^showCommand_(\S+)$/, (ctx) => {
  const command = ctx.match[1];
  const commandInfo = commands.find((cmd) => cmd.command === `/${command}`);
  if (commandInfo) {
    ctx.reply(commandInfo.description);
  }
});

expressApp.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on ${port}`);
});
