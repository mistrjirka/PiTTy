/** Thrown by host tools to raise a specific Python exception in the sandbox. */
export class HostToolError extends Error {
    /** Python exception type to raise, e.g. 'ValueError', 'FileNotFoundError'. */
    pythonType;
    constructor(message, pythonType = 'RuntimeError') {
        super(message);
        this.name = 'HostToolError';
        this.pythonType = pythonType;
    }
}
