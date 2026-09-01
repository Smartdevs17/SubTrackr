/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */

const React = require('react');
const TestRenderer = require('react-test-renderer');

let latestRenderer = null;

function flattenText(node) {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (!node || !node.children) {
    return '';
  }
  return node.children.map(flattenText).join('');
}

function findAll(root, predicate) {
  return root.findAll((node) => {
    try {
      return predicate(node);
    } catch {
      return false;
    }
  });
}

function buildQueries(renderer) {
  const root = renderer.root;

  const getByTestId = (testID) => {
    const matches = findAll(root, (node) => node.props?.testID === testID);
    if (matches.length === 0) {
      throw new Error(`Unable to find element with testID: ${testID}`);
    }
    return matches[0];
  };

  const getByText = (text) => {
    const matcher =
      text instanceof RegExp ? (value) => text.test(value) : (value) => value === String(text);
    const matches = findAll(root, (node) => matcher(flattenText(node)));
    if (matches.length === 0) {
      throw new Error(`Unable to find element with text: ${String(text)}`);
    }
    return matches[0];
  };

  const queryByText = (text) => {
    try {
      return getByText(text);
    } catch {
      return null;
    }
  };

  return {
    getByTestId,
    getByText,
    queryByText,
    toJSON: () => renderer.toJSON(),
    update: (element) => renderer.update(element),
    unmount: () => renderer.unmount(),
  };
}

function render(element) {
  TestRenderer.act(() => {
    latestRenderer = TestRenderer.create(element);
  });
  return buildQueries(latestRenderer);
}

const fireEvent = {
  press(element) {
    TestRenderer.act(() => {
      element.props?.onPress?.();
    });
  },
  changeText(element, value) {
    TestRenderer.act(() => {
      element.props?.onChangeText?.(value);
    });
  },
};

async function waitFor(assertion, { timeout = 1000, interval = 10 } = {}) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeout) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError;
}

function renderHook(callback) {
  const result = { current: undefined };
  function HookHost() {
    result.current = callback();
    return React.createElement('HookHost');
  }
  const rendered = render(React.createElement(HookHost));
  return { result, ...rendered };
}

module.exports = {
  act: TestRenderer.act,
  fireEvent,
  render,
  renderHook,
  screen: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!latestRenderer) {
          throw new Error('screen is unavailable before render()');
        }
        return buildQueries(latestRenderer)[prop];
      },
    }
  ),
  waitFor,
};
