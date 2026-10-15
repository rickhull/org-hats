// A fake port for tests. The port is two questions; a fake is two functions.
//
// Hosts test route wiring and decision mapping without a driver: supply the
// hats as literal `HeldHat` records — extended with names if the audit row
// needs legibility, since the interface is structural and open — and,
// optionally, the read answer. Pure, so it lives inside the fence.
export function fakeRepository(hats, read) {
    return {
        async hatsOf(actorId, operationId) {
            return await hats(actorId, operationId);
        },
        async readableTeamsAt(list, operationId, scopePath) {
            return read ? await read(list, operationId, scopePath) : [];
        },
    };
}
