import assert from 'assert';
import TestHelper, { CARBON, SETUP_TIMEOUT, SILICON, SIMPLE } from './TestHelper';
const { performance } = require('perf_hooks');

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
        const startTime = performance.now()

        let printTime = () => console.log("Passed time: ", (performance.now() - startTime), "ms");

        console.log("1. DEBUG!");
        printTime();
        TestHelper.resetErrors();
        // 1 verification is expected, there should be no subsequent ones
        const verified = TestHelper.waitForVerification(SIMPLE)
            .then(() => TestHelper.waitForTimeout(5000, TestHelper.waitForVerification(SIMPLE)));
        console.log("3. DEBUG!");
        printTime();
        await TestHelper.openFile(SIMPLE);
        console.log("4. DEBUG!");
        printTime();
        //submit 10 verification requests
        for (let i = 0; i < 10; i++) {
            console.log("5. DEBUG! " + i);
            printTime();
            await TestHelper.verify();
        }
        console.log("6. DEBUG!");
        printTime();
        const timeout = await verified;
        console.log("7. DEBUG!");
        printTime();
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
