/** Shop fixture app: search, category filter, paging, cart, checkout, verify. */

import type { ScreenSpec, SimApp, UiNodeSpec } from '../ui.js';
import { backButton, button, chunk, inputNode, row, screen, textNode } from '../ui.js';
import { beginForm, field, setField } from '../world.js';
import type { Product, ProductCategory, WorldState } from '../world.js';

const PACKAGE = 'com.example.shop';
const PAGE_SIZE = 2;
const CATEGORIES: Array<'All' | ProductCategory> = ['All', 'Audio', 'Home', 'Office'];

function filteredProducts(world: WorldState): Product[] {
  const query = field(world, 'shopSearch', 'query').trim().toLowerCase();
  return world.shop.products.filter((product) => {
    if (world.shop.category !== 'All' && product.category !== world.shop.category) return false;
    if (query.length === 0) return true;
    return product.name.toLowerCase().includes(query);
  });
}

function categoryButtons(world: WorldState): UiNodeSpec[] {
  return CATEGORIES.map((category) =>
    button(
      `shop.category.${category.toLowerCase()}`,
      `${category}${world.shop.category === category ? ' (selected)' : ''}`,
      (context) => {
        context.world.shop.category = category;
      },
    ),
  );
}

function home(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Shop', [
    inputNode('shop.search', 'Search products', field(world, 'shopSearch', 'query'), (context, text) => {
      setField(context.world, 'shopSearch', 'query', text);
    }),
    button('shop.search.submit', 'Search', (context) => {
      context.navigate('shop.results');
    }),
    row('shop.open.cart', `Cart: ${world.shop.cart.length} item(s)`, (context) => {
      context.navigate('shop.cart');
    }),
    row('shop.open.verify', 'Verify account', (context) => {
      beginForm(context.world, 'shopVerify', { code: '' });
      context.navigate('shop.verify');
    }),
  ]);
}

function results(world: WorldState): ScreenSpec {
  const products = filteredProducts(world);
  const pages = chunk(products, PAGE_SIZE).map((pageProducts) =>
    pageProducts.map((product) =>
      row(
        `shop.product.${product.id}`,
        `${product.name} — $${product.price.toFixed(2)} — ${product.rating.toFixed(1)} stars`,
        (context) => {
          context.world.selection.productId = product.id;
          context.navigate('shop.detail');
        },
      ),
    ),
  );
  return {
    package: PACKAGE,
    title: `Results: ${field(world, 'shopSearch', 'query') || 'all products'} · ${world.shop.category}`,
    pages: pages.map((nodes, index) => [
      textNode('shop.results.summary', `Showing ${products.length} product(s), page ${index + 1} of ${pages.length}`),
      ...categoryButtons(world),
      ...nodes,
      ...(products.length === 0 ? [textNode('shop.results.empty', 'No products match.')] : []),
      backButton(),
    ]),
  };
}

function detail(world: WorldState): ScreenSpec {
  const product = world.shop.products.find((candidate) => candidate.id === world.selection.productId);
  if (product === undefined) {
    return screen(PACKAGE, 'Product', [textNode('shop.detail.none', 'No product selected.'), backButton()]);
  }
  return screen(PACKAGE, product.name, [
    textNode('shop.detail.name', product.name),
    textNode('shop.detail.price', `Price: $${product.price.toFixed(2)}`),
    textNode('shop.detail.rating', `Rating: ${product.rating.toFixed(1)} stars`),
    button('shop.detail.addToCart', 'Add to cart', (context) => {
      context.world.shop.cart.push(product.id);
      context.toast(`${product.name} added to cart.`);
    }),
    button(
      'shop.detail.buyNow',
      'Buy now',
      (context) => {
        context.toast('Payment requires device confirmation.');
      },
      { danger: 'payment' },
    ),
    backButton(),
  ]);
}

function cart(world: WorldState): ScreenSpec {
  const items = world.shop.cart
    .map((id) => world.shop.products.find((product) => product.id === id))
    .filter((product): product is Product => product !== undefined);
  const total = items.reduce((amount, product) => amount + product.price, 0);
  return screen(PACKAGE, 'Cart', [
    textNode('shop.cart.summary', `${items.length} item(s), total $${total.toFixed(2)}`),
    ...items.map((product) => textNode(`shop.cart.item.${product.id}`, `${product.name} — $${product.price.toFixed(2)}`)),
    button('shop.cart.checkout', 'Checkout', (context) => {
      beginForm(context.world, 'shopCheckout', { address: context.world.shop.checkoutAddress });
      context.navigate('shop.checkout');
    }),
    backButton(),
  ]);
}

function checkout(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Checkout', [
    inputNode('shop.checkout.address', 'Delivery address', field(world, 'shopCheckout', 'address'), (context, text) => {
      setField(context.world, 'shopCheckout', 'address', text);
    }),
    button('shop.checkout.save', 'Save address', (context) => {
      const address = field(context.world, 'shopCheckout', 'address').trim();
      if (address.length === 0) {
        context.toast('Address is required.');
        return;
      }
      context.world.shop.checkoutAddress = address;
      context.toast('Address saved.');
      context.navigate('shop.home');
    }),
    button(
      'shop.checkout.placeOrder',
      'Place order',
      (context) => {
        context.toast('Payment requires device confirmation.');
      },
      { danger: 'payment' },
    ),
    backButton(),
  ]);
}

function verify(world: WorldState): ScreenSpec {
  return screen(PACKAGE, 'Verify account', [
    inputNode('shop.verify.code', 'Verification code', field(world, 'shopVerify', 'code'), (context, text) => {
      setField(context.world, 'shopVerify', 'code', text);
    }),
    button('shop.verify.submit', 'Verify', (context) => {
      const code = field(context.world, 'shopVerify', 'code').trim();
      if (code !== context.world.shop.verifyCode) {
        context.toast('Invalid verification code.');
        return;
      }
      context.world.shop.verified = true;
      context.toast('Account verified.');
      context.navigate('shop.home');
    }),
    backButton(),
  ]);
}

export const shopApp: SimApp = {
  package: PACKAGE,
  label: 'Shop',
  entry: 'shop.home',
  screens: {
    'shop.home': home,
    'shop.results': results,
    'shop.detail': detail,
    'shop.cart': cart,
    'shop.checkout': checkout,
    'shop.verify': verify,
  },
};
