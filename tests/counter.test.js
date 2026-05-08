import { setupCounter } from '../src/counter.js';
import assert from 'node:assert';
import { test, describe } from 'node:test';

describe('setupCounter', () => {
    test('should update textContent when element is clicked', () => {
        let clickHandler = null;
        const mockElement = {
            textContent: '',
            addEventListener: (event, handler) => {
                if (event === 'click') {
                    clickHandler = handler;
                }
            },
            // To ensure innerHTML is not used
            set innerHTML(val) {
                throw new Error('innerHTML should not be used');
            }
        };

        setupCounter(mockElement);

        assert.strictEqual(mockElement.textContent, 'Count is 0');

        if (clickHandler) {
            clickHandler();
            assert.strictEqual(mockElement.textContent, 'Count is 1');
            clickHandler();
            assert.strictEqual(mockElement.textContent, 'Count is 2');
        } else {
            assert.fail('Click handler was not registered');
        }
    });

    test('should not use innerHTML', () => {
        const mockElement = {
            textContent: '',
            addEventListener: () => {},
            set innerHTML(val) {
                assert.fail('innerHTML was used');
            }
        };

        try {
            setupCounter(mockElement);
        } catch (e) {
            if (e.message === 'innerHTML was used') throw e;
        }
    });
});
