import assert from 'assert';
import TestHelper, { CARBON, SETUP_TIMEOUT, SILICON, SIMPLE } from './TestHelper';

suite('ViperIDE Stress Tests', () => {
    suiteSetup(async function() {
        this.timeout(SETUP_TIMEOUT);
        await TestHelper.setup();
    });

    suiteTeardown(async function() {
        await TestHelper.teardown();
    });

    test("1. multiple fast verification requests", async function() {
        this.timeout(15000);

        TestHelper.resetErrors();
        // 1 verification is expected, there should be no subsequent ones
        const verified = TestHelper.waitForVerification(SIMPLE)
            .then(() => TestHelper.waitForTimeout(5000, TestHelper.waitForVerification(SIMPLE)));
        await TestHelper.openFile(SIMPLE);
        //submit 10 verification requests
        for (let i = 0; i < 10; i++) {
            await TestHelper.verify();
        }
        const timeout = await verified;
        assert(timeout, "multiple verifications seen");
    });

    test("3. quickly start, stop, and restart verification", async function() {
        this.timeout(15000);

        TestHelper.resetErrors();

        await TestHelper.openFile(SIMPLE);
        await TestHelper.verify();
        await TestHelper.stopVerification();
        const verified = TestHelper.waitForVerification(SIMPLE);
        await TestHelper.verify();
        await verified;
        assert(!TestHelper.hasObservedInternalError());
    });
});
