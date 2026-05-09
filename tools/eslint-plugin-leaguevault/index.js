import noItSkipPlaceholder from './rules/no-it-skip-placeholder.js';
import noUnscopedTableQueryInTestAssertion from './rules/no-unscoped-table-query-in-test-assertion.js';
import noSpawnTsxInTest from './rules/no-spawn-tsx-in-test.js';

const plugin = {
  meta: { name: 'leaguevault', version: '1.0.0' },
  rules: {
    'no-it-skip-placeholder': noItSkipPlaceholder,
    'no-unscoped-table-query-in-test-assertion': noUnscopedTableQueryInTestAssertion,
    'no-spawn-tsx-in-test': noSpawnTsxInTest,
  },
};

export default plugin;
