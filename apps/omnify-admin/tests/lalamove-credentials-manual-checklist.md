# Lalamove Credentials Manual Verification

- [ ] Open `Carriers` tab and confirm `Lalamove API` row is visible after `Providers`.
- [ ] Confirm API panel is hidden by default and opens only after clicking `Configure API`.
- [ ] Click `Cancel` and confirm panel closes without saving.
- [ ] Submit empty key/secret and confirm inline validation error appears (no application crash).
- [ ] Submit invalid credentials and run `Verify credentials`; confirm safe error message is shown.
- [ ] Submit sandbox credentials while production host is configured; confirm warning guidance appears.
- [ ] Submit production credentials while sandbox host is configured; confirm warning guidance appears.
- [ ] Trigger repeated verify calls quickly; confirm throttling message appears.
- [ ] Simulate/trigger `429` and confirm user sees rate-limit guidance.
- [ ] Remove credentials and confirm status returns to `Not configured`.
