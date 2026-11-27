# Technical debt

Accepted compromises: what was accepted, why, and what would retire it.

| Item | Why accepted | Retired by |
| --- | --- | --- |
| The provisioning reports (`SetupReport`, `ProvisionReport`, readiness) are copied by hand in `provision-dialog.tsx`, `readiness-checklist.tsx` and `router-connection-test.tsx` | They are large internal shapes that change with provisioning | Moving them into `@hashinet/types` |
| A second setup or provision on a router already running one is not refused | Claiming the `provisioning` status needs a staleness rule, or a crash leaves the router stuck | A run lease with an expiry |
| Team invitations (`team.service.ts`) and business invitations (`invitations.service.ts`) each issue, rotate and revoke their own tokens | Two callers with different scopes, roles and emails; merging them now would guess the third's shape | Slice 2's business team invitations: one invitation module for all three |
| A venue serves no guest before its owner protects their sign-in only on the portal's routes (`GuestService.routerOf`); a voucher already on a router could still be accepted by the router's own login page | Vouchers reach a router only once someone protected has printed or sold them | A `venueMayServe` check where serving is switched on (router sync and setup), confirmed against a real router's hotspot login |
| Issues lists the latest 200 issues, without paging | A workspace has tens of open issues; resolved ones accumulate slowly | Paging on Issues when a workspace's history grows past it |
| A change to a business's service access needs a protected platform session, not a fresh authenticator code as ADR-0014, 4 asks | No step-up exists yet, and every platform session already signed in with an authenticator | A step-up check (a fresh code within minutes) for service access, suspension and other overrides |
| The Fees form lists its pay-to and issuer fields four times (`fees/page.tsx`: the form type, `formOf`, the payload, the field lists) | Small, stable, and working | Field lists that drive the form, its state and its payload |
| The Captive portal preview runs inside the guest portal (`GuestPortal` with `preview`), guarding each effect and handler | It keeps the preview the component guests get (ADR-0009, 6) with a small change | The portal split into views (stage in, page out) and effects (fetch, poll, storage), the preview driving the views with a stub |
| Removing a site deletes its unpaid slot invoice, number and all, as an unpaid onboarding invoice reduced to nothing is deleted; the owner is not told | Invoices have no cancelled state, and nothing was paid | A cancelled invoice state, kept and shown with its number, and an email to the owner when one is cancelled |
