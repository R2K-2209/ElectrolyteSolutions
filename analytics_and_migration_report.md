# NexScan Analytics & Schema Migration Report

This report provides the business intelligence queries needed for the company dashboard and details the database design differences between the previous Bajaj database and the new normalized schema.

---

## Part 1: Top 12 Analytical Dashboard Queries

The following queries are designed for PostgreSQL to feed real-time charts and summaries on the company dashboard.

### 1. Monthly Repair Turnaround Time (TAT)
*   **Purpose**: Measures operational speed by calculating the average days taken from receiving a job to dispatch.
```sql
SELECT 
    TO_CHAR(rj.created_at, 'YYYY-MM') AS month,
    COUNT(rj.id) AS total_dispatched_jobs,
    ROUND(AVG(EXTRACT(DAY FROM (dd.dispatch_date::timestamp - rj.created_at)))::numeric, 2) AS avg_turnaround_days
FROM 
    public.repair_jobs rj
JOIN 
    public.dispatch_details dd ON rj.id = dd.job_id
WHERE 
    rj.status = 'DISPATCHED'
GROUP BY 
    1
ORDER BY 
    1 DESC;
```

### 2. Top 5 Failing PCB Models (Product Failure Rate)
*   **Purpose**: Identifies which PCB models fail most frequently, indicating potential design or supply weaknesses.
```sql
SELECT 
    p.part_code,
    p.description,
    COUNT(rj.id) AS total_failures
FROM 
    public.repair_jobs rj
JOIN 
    public.products p ON rj.product_id = p.id
GROUP BY 
    p.id, p.part_code, p.description
ORDER BY 
    total_failures DESC
LIMIT 5;
```

### 3. Defect Analysis (Top Incoming Symptoms)
*   **Purpose**: Displays a breakdown of incoming customer complaints to identify patterns in how boards fail in the field.
```sql
SELECT 
    dt.name AS defect_symptom,
    COUNT(rj.id) AS ticket_count,
    ROUND((COUNT(rj.id)::float / (SELECT COUNT(*) FROM public.repair_jobs) * 100)::numeric, 2) AS percentage_of_total
FROM 
    public.repair_jobs rj
JOIN 
    public.defect_types dt ON rj.defect_id = dt.id
GROUP BY 
    dt.id, dt.name
ORDER BY 
    ticket_count DESC;
```

### 4. Root Cause Breakdown (Failure Types)
*   **Purpose**: Analyzes diagnostic outcomes to see which actual components or systems are breaking (e.g., Short Circuit, Voltage Surge).
```sql
SELECT 
    ft.name AS root_cause,
    COUNT(rd.job_id) AS incident_count
FROM 
    public.repair_details rd
JOIN 
    public.failure_types ft ON rd.failure_type_id = ft.id
GROUP BY 
    ft.id, ft.name
ORDER BY 
    incident_count DESC;
```

### 5. Top 10 Replaced Components (Spare Consumption Pareto)
*   **Purpose**: Pinpoints the exact component locations on the PCBs that are replaced most often (e.g., specific capacitors/diodes).
```sql
SELECT 
    sp.part_name,
    b.location AS schematic_position,
    SUM(jc.quantity) AS total_quantity_consumed
FROM 
    public.job_consumptions jc
JOIN 
    public.spare_parts sp ON jc.spare_part_id = sp.id
LEFT JOIN 
    public.bom b ON jc.bom_id = b.id
GROUP BY 
    sp.id, sp.part_name, b.location
ORDER BY 
    total_quantity_consumed DESC
LIMIT 10;
```

### 6. Urgent Stock Replenishment Alert (Under 20% Threshold)
*   **Purpose**: Flags spare parts that have dropped below their designated reorder threshold so procurement can buy more.
```sql
SELECT 
    part_name,
    stock_quantity,
    reorder_threshold,
    initial_quantity,
    ROUND(((stock_quantity::float / initial_quantity) * 100)::numeric, 2) AS stock_percentage
FROM 
    public.spare_parts
WHERE 
    stock_quantity <= reorder_threshold
ORDER BY 
    stock_percentage ASC;
```

### 7. Engineer Velocity & Repair Quality Score
*   **Purpose**: Monitors technician performance by showing total repairs done and their testing success rates.
```sql
SELECT 
    e.name AS engineer_name,
    COUNT(rd.job_id) AS total_jobs_worked,
    SUM(CASE WHEN rd.testing = 'PASS' THEN 1 ELSE 0 END) AS passed_jobs,
    ROUND((SUM(CASE WHEN rd.testing = 'PASS' THEN 1 ELSE 0 END)::float / COUNT(rd.job_id) * 100)::numeric, 2) AS pass_rate_percentage
FROM 
    public.repair_details rd
JOIN 
    public.engineers e ON rd.engg_id = e.id
GROUP BY 
    e.id, e.name
ORDER BY 
    total_jobs_worked DESC;
```

### 8. Geographical Failure Volume (Branch Analysis)
*   **Purpose**: Heatmap data showing where most faulty boards are originating from geographically.
```sql
SELECT 
    b.state,
    b.city,
    b.name AS branch_name,
    COUNT(rj.id) AS total_jobs
FROM 
    public.repair_jobs rj
JOIN 
    public.branches b ON rj.branch_id = b.id
GROUP BY 
    b.id, b.state, b.city, b.name
ORDER BY 
    total_jobs DESC;
```

### 9. First-Time-Right (FTR) Quality Rate
*   **Purpose**: Measures the global percentage of successful repairs on the first testing pass.
```sql
SELECT 
    testing AS test_status,
    COUNT(job_id) AS volume,
    ROUND((COUNT(job_id)::float / (SELECT COUNT(*) FROM public.repair_details) * 100)::numeric, 2) AS percentage
FROM 
    public.repair_details
GROUP BY 
    testing;
```

### 10. Repeat Failures (Recidivism Rate)
*   **Purpose**: Flags units that came in for repair more than once. Helps identify boards that were poorly repaired or have recurring electrical issues.
```sql
SELECT 
    rj.product_sr_no,
    p.part_code,
    COUNT(rj.id) AS return_count
FROM 
    public.repair_jobs rj
JOIN 
    public.products p ON rj.product_id = p.id
GROUP BY 
    rj.product_sr_no, p.part_code
HAVING 
    COUNT(rj.id) > 1
ORDER BY 
    return_count DESC;
```

### 11. Monthly Inventory Consumption Value & Activity
*   **Purpose**: Financial audit tracking of spare parts leaving inventory.
```sql
SELECT 
    TO_CHAR(consumed_at, 'YYYY-MM') AS month,
    COUNT(id) AS parts_issued_count,
    SUM(quantity) AS total_quantity_issued
FROM 
    public.job_consumptions
GROUP BY 
    1
ORDER BY 
    1 DESC;
```

### 12. Current Backlog & Job Status Funnel
*   **Purpose**: High-level funnel metrics showing where all PCBs sit in the process.
```sql
SELECT 
    status,
    COUNT(id) AS job_count,
    ROUND((COUNT(id)::float / (SELECT COUNT(*) FROM public.repair_jobs) * 100)::numeric, 2) AS percentage
FROM 
    public.repair_jobs
GROUP BY 
    status
ORDER BY 
    job_count DESC;
```

---

## Part 2: Old vs. New Database Schema Comparison

Here is a summary of how the database has been restructured from the flat-file design to the normalized system:

### 1. Flat Tables Normalized to Masters
*   **Old Database**: The main table `consolidated_data` stored all textual details inline (e.g. repeating product descriptions, branch names, engineer names, and customer complaint strings). This wasted space and caused typos (e.g., `'mumbai'` vs `'Mumbai'` vs `'Mumba'`).
*   **New Schema**: Segmented into 6 master tables (`products`, `branches`, `engineers`, `defect_types`, `failure_types`, `users`).
*   **Example**:
    *   *Old Insert*: `INSERT INTO consolidated_data (branch, visiting_tech_name) VALUES ('Mumbai Branch', 'John Doe');`
    *   *New Insert*: `INSERT INTO repair_jobs (branch_id, visiting_tech_name) VALUES (1, 'John Doe');` (where `1` points to Mumbai in the `branches` table, enforcing geographic integrity).

### 2. Component Consumption Restructuring
*   **Old Database**: Replaced parts were stored in a single text column `component_change` (e.g., `"Replaced R1 and C2"`). This made it impossible to run stock checks or search for components electronically.
*   **New Schema**: Normalized into the `job_consumptions` table. It links every single replaced component directly to its physical record in `spare_parts` and its schematic position in `bom`.
*   **Example**:
    *   *Old*: `UPDATE consolidated_data SET component_change = 'Replaced CSC7222 DIP-8 at IC1' WHERE id = 12;`
    *   *New*: `INSERT INTO job_consumptions (job_id, bom_id, spare_part_id, quantity) VALUES (12, 5, 22, 1);` (which links the job to the exact BOM entry and spare part, and automatically decrements inventory stock).

### 3. Smart Inventory Management
*   **Old Database**: Had no concept of warehouse inventory or reorder levels.
*   **New Schema**: Introduced the `spare_parts` inventory table tracking `stock_quantity`, `initial_quantity`, and `reorder_threshold`.
*   **Example**: A trigger automatically flags procurement when stock drops below 20% of the initial balance:
    ```sql
    -- Automatically calculated trigger logic
    WHERE stock_quantity <= reorder_threshold
    ```

### 4. Many-to-Many Delivery Challan (DC) Mapping
*   **Old Database**: `dc_numbers` stored `part_codes` in a raw JSONB list (`['PC1', 'PC2']`) or comma-separated text. This prevented indexing and broken relations.
*   **New Schema**: Replaced with a standard junction table `dc_product_map` containing a `quantity` tracking column.
*   **Example**:
    *   *Old*: `INSERT INTO dc_numbers (dc_number, part_codes) VALUES ('DC-100', '["PC1", "PC2"]');`
    *   *New*: 
        ```sql
        INSERT INTO dc_numbers (dc_number) VALUES ('DC-100');
        INSERT INTO dc_product_map (dc_id, product_id, quantity) VALUES (1, 10, 5); -- 5 units of product 10
        ```

### 5. Multi-User Audit Trail
*   **Old Database**: Stored raw user identifiers as plain text strings (`tag_entry_by`, `consumption_entry_by`, `dispatch_entry_by`).
*   **New Schema**: Linked directly to the Postgres `users` table via foreign keys using UUIDs synchronized with Supabase authentication.
*   **Example**:
    *   *Old*: `UPDATE consolidated_data SET tag_entry_by = 'admin@nexscan.com';`
    *   *New*: `UPDATE repair_jobs SET tag_entry_by = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';`

### 6. Real-Time Automation & Integrity Triggers
*   **Old Database**: Depended entirely on application-side logic to compute edits, check ranges, and update timestamps.
*   **New Schema**: Employs built-in database-layer validation and triggers:
    *   Automatic `updated_at` timestamps on row modification.
    *   Automatic stock decrements/adjustments via the `update_stock_on_consumption()` trigger.
    *   Status checks (e.g., preventing status input other than `PENDING`, `REPAIRED`, `DISPATCHED`, `SCRAP`).
    *   Uniqueness on barcode scanning (`pcb_sr_no UNIQUE`).
    *   `inventory_transactions` ledger for audit logs.
