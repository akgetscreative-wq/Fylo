// Defensive initialization to guarantee console exists in all JS engines
if (typeof global !== 'undefined') {
  if (typeof global.console === 'undefined') {
    const noop = () => {};
    global.console = {
      log: noop,
      info: noop,
      warn: noop,
      error: noop,
      debug: noop,
      trace: noop,
    };
  }
}

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
