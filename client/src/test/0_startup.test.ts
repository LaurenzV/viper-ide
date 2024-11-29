import TestHelper, { CARBON, EMPTY, LONG, SETUP_TIMEOUT, SILICON, SIMPLE } from './TestHelper';

// this test suite is supposed to be the first one that is executed
// as we can only test that way that the extension is correctly started
// when opening a Viper file.
suite('Extension Startup', () => {

    suiteSetup(async function() {
        this.timeout(SETUP_TIMEOUT);
        await TestHelper.setup();
        // we do not await until a backend has been started as the first test case
        // will check this
        // since this testsuite is run first, `setup()` does not await the extension's start.
        // thus, the first testcase makes sure that the extension is correctly started.
    });

    suiteTeardown(async function() {
        // otherwise the unit test has failed anyways
        await TestHelper.teardown();
    });
});
