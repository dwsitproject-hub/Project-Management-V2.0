# Automated Test Suite

This directory contains automated tests for the Project & Change Request Management application.

## Running Tests

### Prerequisites
- Server must be running on `http://localhost:3000`
- Data must be synced from Google Sheets (both Project and CR tabs)

### Command
```bash
npm test
# or
node tests/test-suite.js
```

## Test Coverage

The test suite covers the following areas:

### 1. Server Health Check
- ✅ Server is running and serving content
- ✅ Homepage loads correctly

### 2. API Endpoints
- ✅ `/api/initiatives` - Project and CR data
- ✅ `/api/lookups` - Users and departments
- ✅ `/api/dashboard` - Dashboard analytics

### 3. Data Loading
- ✅ **Project Data**: Validates project data structure and content
- ✅ **CR Data**: Validates change request data structure and content
- ✅ **CR Timeline**: Validates CR-specific timeline data (columns R-AE)

### 4. Data Integrity
- ✅ **Lookup Data**: Users and departments available
- ✅ **Dashboard Data**: Project aging and milestone durations
- ✅ **File Structure**: data.json contains all required arrays

### 5. Page Rendering
- ✅ **CR List Page**: Loads with JavaScript for dynamic content
- ✅ **Project Dashboard**: Renders correctly with project-focused analytics

## Test Results

When all tests pass, you should see:
```
📊 Test Results:
✅ Passed: 10
❌ Failed: 0
📈 Success Rate: 100%

🎉 All tests passed! System is working correctly.
```

## Troubleshooting

### Common Issues

1. **Server not running**
   - Start server: `npm start`
   - Check port 3000 is available

2. **No data found**
   - Seed the admin user (`npm run db:seed-admin`) and create a project or CR

3. **API endpoints failing**
   - Check server logs for errors
   - Verify routes are properly configured

4. **Data structure issues**
   - Check data.json format
   - Ensure changeHistory array exists

### Test Timeout
- Tests timeout after 10 seconds
- Increase `TEST_TIMEOUT` if needed for slower systems

## Adding New Tests

To add a new test:

1. Add test object to `tests` array in `test-suite.js`
2. Include `name` and `async run()` function
3. Return success message or throw error for failure
4. Test will run automatically with the suite

Example:
```javascript
{
  name: 'New Feature Test',
  async run() {
    const data = await fetchJSON(`${BASE_URL}/api/new-endpoint`);
    if (!data.feature) {
      throw new Error('New feature not working');
    }
    return '✅ New feature working correctly';
  }
}
```

## Continuous Integration

These tests can be integrated into CI/CD pipelines:

```bash
# Install dependencies
npm install

# Start server in background
npm start &

# Wait for server to start
sleep 5

# Run tests
npm test

# Cleanup
kill %1
```
