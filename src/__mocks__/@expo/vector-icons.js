/**
 * Lightweight Jest mock for @expo/vector-icons.
 *
 * Renders a plain Text element so icon components render in tests without
 * loading the native font assets. All named icon sets map to the same
 * functional component; the mapper in jest.config.js also redirects
 * subpath imports (e.g. '@expo/vector-icons/Ionicons') here.
 */

const React = require('react');
const { Text } = require('react-native');

const Icon = (props) => React.createElement(Text, props, props.name);

const IconSets = {
  MaterialIcons: Icon,
  Ionicons: Icon,
  Feather: Icon,
  FontAwesome: Icon,
  FontAwesome5: Icon,
  FontAwesome6: Icon,
  MaterialCommunityIcons: Icon,
  AntDesign: Icon,
  Entypo: Icon,
  EvilIcons: Icon,
  Fontisto: Icon,
  Foundation: Icon,
  Octicons: Icon,
  SimpleLineIcons: Icon,
  Zocial: Icon,
};

module.exports = {
  __esModule: true,
  ...IconSets,
  default: Icon,
};
