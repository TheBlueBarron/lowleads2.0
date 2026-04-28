// Global Jest setup — runs before each test file
// Integration tests connect to Docker Compose services defined in docker-compose.test.yml

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';

// Integration test env — matches docker-compose.test.yml
process.env['TEST_DATABASE_URL'] =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://lowleads_test:lowleads_test@localhost:5433/lowleads_test';

process.env['TEST_REDIS_URL'] = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6380';
