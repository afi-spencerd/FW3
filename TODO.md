# TODO

## Features

- [x] Separate Inventory from Item Details
- [x] Facilitate sending QC Failed RMs back to Vendor
- [x] Facilitate Scrap in all Inventory stages
- [x] create API for Compounder Tool to report consumptions and batch progress
  - [x] expose formulation details to compounder tool via api
  - [x] expose WO list to compounder tool
- [x] cycle count tool
- [x] allow receiving from vendor as KG, auto convert. disclaimer for conversion formula used.
- [x] location visibility (what's currently on a location)
- [x] sub-locations
- [x] container inventory
- [x] regulatory details for rm
- [x] regulatory details for fg
- [x] erp business variables
  - working hours
  - default profit margin
  - pph per workstation
  - production efficiency
  - company holidays
  - production cost factor (currently 80% RMC)
- [ ] complete QB sync
- [ ] location rules (i.e. no move back to receiving dock after moved to warehouse)
- [ ] profit margin per customer ranking
- [ ] partial payments
  - [ ] mark "paid" when `sum(partial_payment.amount) == due`
- [ ] issue refunds
  - overpayment
  - approved cancellation
- [ ] separate floor from 2lb pours
- [ ] query robot RMs

### Tools

- [ ] scheduling
  - [x] init
- [ ] customer service
  - [ ] make SO "confirmed" or "requested" when customer pays
  - [ ] customer purchase & cost history
  - [ ] merge customer entries (link ids? allow unmerge)
    - [ ] sync history, contacts, addresses
- [ ] sales

### Reports

- [ ] Production Reports
- [ ] Shipping Reports
- [ ] Sales Reports

### Labels

- [ ] receiving
- [ ] retain
- [ ] shipping
- [ ] sample
- [ ] batch

### Documentation

- [x] document compounder tool api

## Fixes

- [x] always use lbs for UOM
- [x] correct broken references to "Stock" page
- [x] broken inventory delete button
  - [x] should only allow adjusting out all inventory, not deleting. all adjustments should be recorded.
  - [x] should not be able to delete an item if inventory transactions exist for it
- [x] containers not showing in inventory
- [x] remove `new item` button (should be managed as adjustments or POs)
  - [x] all "opening stock" on inventory page
- [x] show cost when generating SO
  - [x] prevent "losing our shirt"
  - [x] unit cost per line
  - [x] default to business-wide profit margin
- [ ] schema still showing (itemstock, itemstocklocation) & (inventorytx, locationmove). interrigate agent
- [ ] allow packing before QC
- [ ] sell RM to customer
- [ ] order FG from vendor

## Designer

- [ ] Unique views for specific User Roles
- [ ] improve location visibility UX
- [ ] headers on stock adjustment

## Optimizations

- [ ] decouple qb. generic "Accounting Adapter"
- [ ] "Regulatory Adapter" to communicate with FormPak+
