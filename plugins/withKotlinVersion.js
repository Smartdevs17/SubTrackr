const { withProjectBuildGradle } = require('@expo/config-plugins/build/plugins/android-plugins');

function withKotlinVersion(config, version) {
  return withProjectBuildGradle(config, (config) => {
    const content = config.modResults.contents;
    const marker = 'ext.kotlinVersion';
    if (content.includes(marker)) return config;
    config.modResults.contents = content.replace(
      /(\s*repositories\s*\{)/,
      `$1\n    ext.kotlinVersion = "${version}"`
    );
    return config;
  });
}

module.exports = withKotlinVersion;
