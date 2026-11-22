/**
 * Lightweight Jest mock for expo-linear-gradient.
 *
 * Renders a plain View so components using LinearGradient can be tested
 * without the native gradient module.
 */

const React = require('react');
const { View } = require('react-native');

const LinearGradient = (props) => React.createElement(View, props);

module.exports = {
  __esModule: true,
  LinearGradient,
  default: LinearGradient,
};
