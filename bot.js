const express = require("express");
const expressApp = express();
const axios = require("axios");
const paystack = require("paystack")(process.env.stackSecretKey);
const paystackCallbackUrl = "";
const path = require("path");
const port = process.env.PORT || 3000;
expressApp.use(express.static("static"));
expressApp.use(express.json());
require("dotenv").config();

const {Telegraf, Markup, session} = require("telegraf");

const bot = new Telegraf(process.env.botToken);
bot.use(session());

const products = [
  {
    id: 1,
    name: "Stash Bag",
    price: 10000,
    description: "This will keep you away from us for awhile",
  },
  {
    id: 2,
    name: "Stash Large",
    price: 1000,
    description: "The more the merrier",
  },
  {
    id: 3,
    name: "Stash Small",
    price: 500,
    description: "Going solo?",
  },
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

  if (selectedProduct) {
    const quantity = parseInt(messageText);
    if (!isNaN(quantity) && quantity > 0) {
      const productWithQuantity = {
        product: selectedProduct,
        quantity: quantity,
      };
      ctx.session.cart.push(productWithQuantity);
      ctx.reply(`${quantity} ${selectedProduct.name}(s) added to ${"/cart"}.`);
      ctx.session.selectedProduct = null;
    } else {
      ctx.reply("How many (in digits)? Please try again.");
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

function checkoutCommand(ctx) {
  const cart = ctx.session.cart;

  if (cart.length > 0) {
    const totalPrice = cart.reduce((total, productWithQuantity) => {
      const productPrice =
        productWithQuantity.product.price * productWithQuantity.quantity;
      return total + productPrice;
    }, 0);
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

    ctx.session.orderDetails = {
      products: cart,
      totalPrice: totalPrice,
    };

    ctx.reply(`Selected Products:\n${message}${totalPriceMessage}.`);
    ctx.reply("Please enter your email address:");
  } else {
    ctx.reply("Your cart is empty. Select products first.");
  }
}

bot.on("text", async (ctx) => {
  const messageText = ctx.message.text;
  const orderDetails = ctx.session.orderDetails;

  if (orderDetails) {
    if (!orderDetails.paystackAccessCode) {
      if (!orderDetails.email) {
        const email = messageText.trim();
        if (validateEmail(email)) {
          orderDetails.email = email;
          ctx.reply("Please enter your phone number:");
        } else {
          ctx.reply("Please enter a valid email address.");
        }
      } else if (!orderDetails.phone) {
        const phone = messageText.trim();
        if (validatePhoneNumber(phone)) {
          orderDetails.phone = phone;
          ctx.reply("Please enter your address:");
        } else {
          ctx.reply("Please enter a valid phone number.");
        }
      } else if (!orderDetails.address) {
        const address = messageText.trim();
        if (address.length > 0) {
          orderDetails.address = address;
         await processPayment(orderDetails);
          ctx.reply("Payment processing...");
        } else {
          ctx.reply("Invalid address. Please eter a valid address.");
        }
      }
    } else {
      
    }
  }
});

function validateEmail(email) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

function validatePhoneNumber(phone) {
  const phonePattern = /^\d{10}$/;
  return phonePattern.test(phone);
}

async function processPayment(orderDetails) {
  const paystackSecretKey = process.env.stackSecretKey;
  const email = orderDetails.email;
  const amount = orderDetails.totalPrice * 100;

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        amount,
        callback_url: paystackCallbackUrl,
      },
    {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-type': 'application/json',
      },
    }
    );
    const {authorization_url, access_code} = response.data.data;
    orderDetails.paystackAccessCode = access_code;
    ctx.reply('Please complete the payment by clicking this link: ' + authorization_url);
  } catch (error) {
    console.error('Paystack API error:', error.message);
    ctx.reply('An error occured while processing payment. Please try again.');
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

bot.launch();
