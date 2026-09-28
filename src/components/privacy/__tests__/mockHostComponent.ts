import React from 'react';

/**
 * Module factory replacing a native React Native component with a plain host
 * element that keeps its props inspectable. Used for components that cannot
 * load under Jest here: Switch and Modal fail RN codegen parsing, and
 * TouchableOpacity's disabled-state animation pulls in the native renderer.
 */
export function mockHostComponent(name: string) {
  const Host = ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement(name, props, children);
  return { __esModule: true, default: Host };
}
