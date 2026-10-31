// The case shape shared by every inventory family.
export const modelCase = (id, title, run) => ({
    id,
    title,
    run: async () => {
        run();
    },
});
export const runtimeCase = (id, title, run) => ({ id, title, run });
