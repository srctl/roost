# Audited interruption boundaries

Each cell is a completed disposable test, with its terminal result and operation UUID.
Separate triggers may share a recovery algorithm; repeated debugging runs are excluded.
All reboot entries include an observed QMP RESET and a changed boot ID. All SIGKILL entries
include systemd signal-9 evidence and a newly written helper readiness file.

| Boundary | SIGKILL recovery | VM reboot recovery |
| --- | --- | --- |
| `accepted` | failed (`f08e8063-b21e-4d17-b7dd-495a204c309c`) | failed (`0d65e99e-ad48-4566-a87a-4f67119f8366`) |
| `staged` | failed (`7400cea9-8f6c-49ec-b011-f3a5e8a401d7`) | failed (`05476adf-4c1c-43d3-972b-e234fa0489af`) |
| `draining` | failed (`abbe0189-21a8-465f-91a0-46781720a2f8`) | failed (`b98ff028-48e3-47c2-9711-a212956af5b9`) |
| `stopping` | cancelled (`c6238d99-a44f-4a33-a6aa-c351c7f5de26`) | cancelled (`7a76614e-f5c5-4867-b655-f7b49656f66f`) |
| `service-stopped` | cancelled (`c10ba423-1827-4f9a-a531-7f23c4639738`) | cancelled (`7bc45ef1-6bc5-4921-95c7-811d7c492394`) |
| `snapshot-complete` | rolled-back (`ce27ce9a-3499-4f07-9c0a-7f0421d38fbe`) | rolled-back (`d1188f51-d28b-4d7e-9902-f08359083609`) |
| `activating` | rolled-back (`6e4a0797-cc52-4c46-b187-e1276552edca`) | rolled-back (`27934845-5ee4-47d8-b3d1-4ecd404d18b7`) |
| `pointer-renamed-before-sync` | rolled-back (`f082588b-840d-494f-8f8e-37b0842e1194`) | rolled-back (`0e1ff6d3-2332-4651-8945-40891a055fe5`) |
| `pointer-renamed` | rolled-back (`30af7103-c08a-466a-9fc0-f5b5cf2ae443`) | rolled-back (`bb03c38d-dac7-4ddc-a044-e9a51150ce92`) |
| `verifying` | rolled-back (`df54e456-bf5d-4a5b-b804-0f725030509e`) | rolled-back (`2d4729b8-b96c-402b-9635-260b0e9b8f19`) |
| `service-started` | rolled-back (`bd595f27-4d62-4fff-9bb1-b8355e453e99`) | rolled-back (`8df857aa-6286-4ea9-ba65-cf12c69f4899`) |
| `before-journal-staged` | failed (`4569be4d-bef8-4904-8ca7-3009d6bb5d65`) | failed (`7b8bbd5c-8dca-4ef7-912f-2dc694a29194`) |
| `before-journal-draining` | failed (`1abe9d9b-189e-4f90-9f36-0015951f3f0d`) | failed (`313472d6-d33c-49a1-8dcb-9c313009911e`) |
| `before-journal-stopping` | failed (`976f1d43-3c19-4412-b171-7587ed4a4e85`) | failed (`f92070ea-8c56-42c1-b3df-272f3d684cc5`) |
| `before-journal-snapshot-complete` | cancelled (`604c84de-b8fd-499e-a053-cde4d0b99760`) | cancelled (`974cf536-45bb-43ef-be6f-3837a8e48341`) |
| `before-journal-activating` | rolled-back (`70721c3d-e06b-47ee-9291-22523f7f7109`) | rolled-back (`c63fd846-713f-4573-b123-cecabbd283a5`) |
| `before-journal-verifying` | rolled-back (`d4dbf5ab-5d81-46df-b85b-a785071ea361`) | rolled-back (`ca42de76-27c3-4383-ba50-e69fe41a4798`) |
| `before-journal-committed` | rolled-back (`b5bba1b6-bdeb-420b-a815-8c03b51e9434`) | rolled-back (`bf77fd6b-80f1-44ae-acd7-f376710383c9`) |
| `committed` | succeeded (`805402e3-dc88-47c0-be13-113c456f6df3`) | succeeded (`cf022d06-601f-46d7-833f-4687b3153eae`) |
| `admission-open` | succeeded (`28bd96e1-25c7-46ea-8966-83d6851f8d1b`) | succeeded (`1c9142d3-a4c0-45c1-b3eb-de0b10632545`) |
| `before-journal-succeeded` | succeeded (`c10d8ec7-0572-47b9-bea8-c2b26ebaa53f`) | succeeded (`c2e65ca4-5910-47b7-bd10-270a0f2457bf`) |
| `succeeded` | succeeded (`c4c771fe-74da-42bb-a30a-a1f3c955eaa1`) | succeeded (`cf8e8f02-f836-4ada-b448-1e7f4beca26f`) |
| `before-journal-restoring` | rolled-back (`51bfd931-8756-4620-8f63-663a8e6c67e6`) | rolled-back (`ebca0912-cd10-4daf-9b54-2574d494ca2b`) |
| `restoring` | rolled-back (`297fa737-4641-460d-bd24-fa7d9074e04b`) | rolled-back (`7c256561-e0ac-4f4c-af70-f5c19e4a4939`) |
| `failed-data-renamed-before-sync` | rolled-back (`1b25f6c4-994c-4be2-af15-f40d6ef1f834`) | rolled-back (`e0bf5237-cd7a-42db-ba22-12b34a3ad30d`) |
| `failed-data-renamed` | rolled-back (`f06b82d8-a463-442b-9949-aba5e5118bf5`) | rolled-back (`36e1d31d-bff6-4a81-aaaa-e86433e84893`) |
| `restored-data-renamed-before-sync` | rolled-back (`7852fe25-afe7-4edd-8b1c-309737536b4b`) | rolled-back (`03cc326e-d57a-4a3a-8708-394f7d70335b`) |
| `restored-data-renamed` | rolled-back (`9064b438-99d4-42f6-a148-4f4824b3e82f`) | rolled-back (`23770fc0-7b1d-42cc-8191-0aff450396d7`) |
| `before-journal-rolled-back` | rolled-back (`4b118b7f-69f9-49cb-97d7-8ba2a1941ce7`) | rolled-back (`1c10fa0c-c7c4-4f5e-9a30-71914706ccaa`) |
| `rolled-back` | rolled-back (`5a6cfa44-5bd5-4940-8af2-23e9f940b3f4`) | rolled-back (`70d6c7e1-a18b-4b0b-aa47-5fc1cd723120`) |
| `before-journal-accepted` | no operation accepted (`72675633-2d9d-49ce-a389-642fd4814060`) | no operation accepted (`66834ed9-12a5-465b-9301-2ccedcba6480`) |
| `before-journal-failed` | failed (`ea958297-d997-49a6-abab-86893dff693a`) | failed (`fb6e0338-5036-4dd3-9bff-c58623d89651`) |
| `failed` | failed (`57a6ce3f-f80f-4174-a09b-72f682f25174`) | failed (`e5b66a6f-183d-4464-90a8-c573d7c32b4a`) |
| `before-journal-cancelled` | failed (`2731d147-4bf9-4d7f-972f-f1b6683cca8b`) | failed (`73e1004f-254c-4b3e-8241-f524818c5fac`) |
| `cancelled` | cancelled (`4bc0887f-ec07-4bf6-8bc3-092ebdaa7cbf`) | cancelled (`6d467419-79af-47e4-b089-c291a22b889f`) |
| `before-journal-deferred` | failed (`8470a096-b665-4f69-a769-ba7d619d93eb`) | failed (`34eecb7e-b1dd-437f-a440-b5ea98ce9151`) |
| `deferred` | deferred (`4687d3cc-3c37-451d-8e83-3c4fd4f5d559`) | deferred (`2a4fffa0-8d98-4302-a1af-319516075009`) |
| `before-journal-manual-recovery` | rolled-back (`0d35886f-f782-4efe-b19d-920cdfc9f938`) | rolled-back (`4acb17eb-a34e-4226-9a30-a2345091a3f9`) |
| `manual-recovery` | manual-recovery (`359c5cda-caca-4cd0-9924-420381691020`) | manual-recovery (`7b972ebe-d2e8-4cbe-9502-5b850ed640fb`) |
| `rollback-pointer-renamed-before-sync` | rolled-back (`004f471a-276a-497a-bedf-d043d4a5a8c8`) | rolled-back (`027efc05-9af3-47da-96b2-768a06166170`) |
| `rollback-pointer-renamed` | rolled-back (`ddfa87f4-fcf5-4dbe-9067-e3cac7c0a866`) | rolled-back (`d1f82a68-4a79-4d45-8aaa-72e301875a67`) |
| `rollback-service-started` | rolled-back (`b306674f-2084-445a-8db8-fdada8e2eddb`) | rolled-back (`79c24730-d861-4fe4-bee6-9fa46217374e`) |
