import { setupCounter } from '../src/counter.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('setupCounter', () => {
    const createMockElement = () => {
        let clickHandler = null;
        let innerHTMLVal = '';
        let textContentVal = '';

        return {
            get textContent() { return textContentVal; },
            set textContent(val) { textContentVal = val; },
            get innerHTML() { return innerHTMLVal; },
            set innerHTML(val) { innerHTMLVal = val; },
            addEventListener: (event, handler) => {
                if (event === 'click') {
                    clickHandler = handler;
                }
            },
            get clickHandler() { return clickHandler; }
        };
    };

    const getOutput = (mockElement) => mockElement.textContent || mockElement.innerHTML;

    test('should update element text when initialized', () => {
        const mockElement = createMockElement();
        setupCounter(mockElement);
        assert.strictEqual(getOutput(mockElement), 'Count is 0');
    });

    test('should update element text when element is clicked', () => {
        const mockElement = createMockElement();
        setupCounter(mockElement);
        assert.strictEqual(getOutput(mockElement), 'Count is 0');

        if (mockElement.clickHandler) {
            mockElement.clickHandler();
            assert.strictEqual(getOutput(mockElement), 'Count is 1');
            mockElement.clickHandler();
            assert.strictEqual(getOutput(mockElement), 'Count is 2');
        } else {
            assert.fail('Click handler was not registered');
        }
    });

    test('should handle multiple successive clicks', () => {
        const mockElement = createMockElement();
        setupCounter(mockElement);
        assert.strictEqual(getOutput(mockElement), 'Count is 0');

        if (mockElement.clickHandler) {
            for (let i = 1; i <= 5; i++) {
                mockElement.clickHandler();
                assert.strictEqual(getOutput(mockElement), `Count is ${i}`);
            }
        } else {
            assert.fail('Click handler was not registered');
        }
    });
});
