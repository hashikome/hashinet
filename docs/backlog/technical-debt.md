# Technical debt

Accepted compromises: what was accepted, why, and what would retire it.

| Item | Why accepted | Retired by |
| --- | --- | --- |
| The provisioning reports (`SetupReport`, `ProvisionReport`, readiness) are copied by hand in `provision-dialog.tsx`, `readiness-checklist.tsx` and `router-connection-test.tsx` | They are large internal shapes that change with provisioning | Moving them into `@hashinet/types` |
| A second setup or provision on a router already running one is not refused | Claiming the `provisioning` status needs a staleness rule, or a crash leaves the router stuck | A run lease with an expiry |
| Team invitations (`team.service.ts`) and business invitations (`invitations.service.ts`) each issue, rotate and revoke their own tokens | Two callers with different scopes, roles and emails; merging them now would guess the third's shape | Slice 2's business team invitations: one invitation module for all three |
| A venue serves no guest before its owner protects their sign-in only on the portal's routes (`GuestService.routerOf`); a voucher already on a router could still be accepted by the router's own login page | Vouchers reach a router only once someone protected has printed or sold them | A `venueMayServe` check where serving is switched on (router sync and setup), confirmed against a real router's hotspot login |
| Issues lists the latest 200 issues, without paging | A workspace has tens of open issues; resolved ones accumulate slowly | Paging on Issues when a workspace's history grows past it |
