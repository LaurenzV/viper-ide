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

        console.log("1. DEBUG!");
        TestHelper.resetErrors();
        console.log("2. DEBUG!");
        // 1 verification is expected, there should be no subsequent ones
        const verified = TestHelper.waitForVerification(SIMPLE)
            .then(() => TestHelper.waitForTimeout(5000, TestHelper.waitForVerification(SIMPLE)));
        console.log("3. DEBUG!");
        await TestHelper.openFile(SIMPLE);
        console.log("4. DEBUG!");
        //submit 10 verification requests
        for (let i = 0; i < 10; i++) {
            console.log("5. DEBUG! " + i);
            await TestHelper.verify();
        }
        console.log("6. DEBUG!");
        const timeout = await verified;
        console.log("7. DEBUG!");
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
