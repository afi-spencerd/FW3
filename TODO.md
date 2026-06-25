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
- [x] profit margin per customer ranking
- [x] partial payments
  - [x] mark "paid" when `sum(partial_payment.amount) == due`
- [x] issue refunds
  - overpayment
  - approved cancellation
- [x] separate floor from 2lb pours
- [x] customer PO field on SO
- [x] SO CSV import
- [ ] schedule work order for semi-finished good (base)
- [ ] complete QB sync
- [ ] location rules (i.e. no move back to receiving dock after moved to warehouse)
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
- [x] sell RM to customer
- [x] order FG from vendor
- [x] auto-generate SO number based on existing ERP scheme
- [x] trust proxy in prod for session cookies work on Caddy
- [x] show available stock on WO page
- [ ] FG BOM missing on page
- [ ] default WO number based on existing ERP scheme
- [ ] record QC approve actor
- [ ] record robot operator
- [ ] record all involved compounders (2lb A-F, 2lb G-Z, and Floor)
- [ ] record packer
- [ ] shift times for all 4 shifts (A, B, C, and D)
- [ ] schema still showing (itemstock, itemstocklocation) & (inventorytx, locationmove). interrigate agent
- [ ] allow packing before QC

## Designer

- [ ] Unique views for specific User Roles
- [ ] improve location visibility UX
- [ ] headers on stock adjustment

## Optimizations

- [ ] decouple qb. generic "Accounting Adapter"
- [ ] "Regulatory Adapter" to communicate with FormPak+
