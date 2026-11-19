import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Pages such as the dashboard load on demand; under coverage instrumentation that import can
// take longer than the default 1 s, so findBy/waitFor wait up to 8 s before failing.
configure({ asyncUtilTimeout: 8000 });
