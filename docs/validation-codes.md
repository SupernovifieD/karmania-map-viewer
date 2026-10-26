# Validation codes

Every finding code, with its severity, the wizard step that can fix it, its
message template, its hint and an example. Codes are stable: never rename one or
change its meaning; add a new code instead. Sections are sorted by code.

A unit test in `karmania-core` fails if a registered code is missing here, if its
severity or step disagrees with the registry, or if this file lists a code that
is not registered. In message templates, `{name}` marks a value filled in at
runtime. Numbers in messages use thousands separators (1,203).

## `dataset.coordinates.incomplete`

- Severity: error
- Step: none
- Message: The coordinate list ends with an incomplete position: it has {count} values, which is not a multiple of 3.
- Hint: Give X, Y and Z for every position.
- Example: The coordinate list ends with an incomplete position: it has 4 values, which is not a multiple of 3.

## `dataset.coordinates.length_mismatch`

- Severity: error
- Step: none
- Message: The coordinate lists have different lengths: X has {nx} values, Y has {ny}[, Z has {nz}].
- Hint: Give X, Y and Z (if used) the same number of values.
- Example: The coordinate lists have different lengths: X has 1,204 values, Y has 5.

## `dataset.empty`

- Severity: error
- Step: file
- Message: The dataset has no {things}.
- Hint: Check that the file has data rows and that you chose the right file.
- Example: The dataset has no points.

## `dataset.too_large`

- Severity: error
- Step: none
- Message: This dataset would have about {count} {things}, which is more than the limit of {limit}. (When the count is too large to calculate: This dataset would have far more {things} than the limit of {limit}.)
- Hint: Use fewer {things}, or split the data into several datasets.
- Example: This dataset would have about 200,000,000 cells, which is more than the limit of 134,217,728.

## `lattice.dims.zero`

- Severity: error
- Step: none
- Message: The {grid or block model} has no cells along at least one axis ({nx} x {ny} x {nz}); every dimension must be at least 1.
- Hint: Check the number of cells along each axis.
- Example: The grid has no cells along at least one axis (4 x 0 x 1); every dimension must be at least 1.

## `lattice.origin.not_finite`

- Severity: error
- Step: none
- Message: The position of the {grid or block model} must be made of numbers, but its corner is {x}, {y}, {z}.
- Hint: Give the X, Y and Z of the grid's lower corner.
- Example: The position of the grid must be made of numbers, but its corner is 0, NaN, 0.

## `lattice.rotation.not_finite`

- Severity: error
- Step: none
- Message: The rotation of the {grid or block model} must be a number of degrees, but it is {value}.
- Hint: Use 0 for a grid aligned with north.
- Example: The rotation of the grid must be a number of degrees, but it is inf.

## `lattice.spacing.invalid`

- Severity: error
- Step: none
- Message: The cell size of the {grid or block model} must be greater than 0 on every axis, but it is {dx} x {dy} x {dz}.
- Hint: Use a positive cell size, such as 10 for 10-metre cells.
- Example: The cell size of the grid must be greater than 0 on every axis, but it is 10 x 0 x 1.

## `lines.line.too_short`

- Severity: warning
- Step: none
- Message: Some lines have fewer than 2 vertices, so they cannot be drawn.
- Hint: Remove those lines or add the missing vertices.
- Example: Some lines have fewer than 2 vertices, so they cannot be drawn.

## `lines.offsets.bad_end`

- Severity: error
- Step: none
- Message: The list that says where each line starts must end with the number of vertices ({expected}), but it ends with {actual}.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each line starts must end with the number of vertices (5), but it ends with 4.

## `lines.offsets.bad_start`

- Severity: error
- Step: none
- Message: The list that says where each line starts must start with 0, but it starts with {actual}.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each line starts must start with 0, but it starts with 1.

## `lines.offsets.decreasing`

- Severity: error
- Step: none
- Message: Some lines end before they start.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: Some lines end before they start.

## `lines.offsets.empty`

- Severity: error
- Step: none
- Message: The list that says where each line starts is empty. It must start with 0 and end with the number of vertices ({expected}).
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each line starts is empty. It must start with 0 and end with the number of vertices (3).

## `mesh.indices.incomplete`

- Severity: error
- Step: none
- Message: The triangle list ends with an incomplete triangle: it has {count} vertex numbers, which is not a multiple of 3.
- Hint: Give three vertex numbers for every triangle.
- Example: The triangle list ends with an incomplete triangle: it has 5 vertex numbers, which is not a multiple of 3.

## `mesh.indices.out_of_range`

- Severity: error
- Step: none
- Message: Some triangles use vertex numbers that do not exist: the mesh has {count} vertices.
- Hint: Vertex numbers start at 0 and must be lower than the number of vertices.
- Example: Some triangles use vertex numbers that do not exist: the mesh has 3 vertices.

## `mesh.triangle.degenerate`

- Severity: warning
- Step: none
- Message: Some triangles have no area: two corners are the same point, or all three are in a straight line.
- Hint: Remove those triangles; they cannot be shaded.
- Example: Some triangles have no area: two corners are the same point, or all three are in a straight line.

## `mesh.vertices.unused`

- Severity: info
- Step: none
- Message: Some vertices are not used by any triangle.
- Hint: none
- Example: Some vertices are not used by any triangle.

## `polygons.polygon.no_rings`

- Severity: error
- Step: none
- Message: Some polygons have no rings, so they have no outline.
- Hint: Remove those polygons or give each one an outer ring.
- Example: Some polygons have no rings, so they have no outline.

## `polygons.polygon_offsets.bad_end`

- Severity: error
- Step: none
- Message: The list that says which rings belong to each polygon must end with the number of rings ({expected}), but it ends with {actual}.
- Hint: Start with 0, end with the number of rings, and never go backwards.
- Example: The list that says which rings belong to each polygon must end with the number of rings (2), but it ends with 1.

## `polygons.polygon_offsets.bad_start`

- Severity: error
- Step: none
- Message: The list that says which rings belong to each polygon must start with 0, but it starts with {actual}.
- Hint: Start with 0, end with the number of rings, and never go backwards.
- Example: The list that says which rings belong to each polygon must start with 0, but it starts with 1.

## `polygons.polygon_offsets.decreasing`

- Severity: error
- Step: none
- Message: Some polygons end before they start.
- Hint: Start with 0, end with the number of rings, and never go backwards.
- Example: Some polygons end before they start.

## `polygons.polygon_offsets.empty`

- Severity: error
- Step: none
- Message: The list that says which rings belong to each polygon is empty. It must start with 0 and end with the number of rings ({expected}).
- Hint: Start with 0, end with the number of rings, and never go backwards.
- Example: The list that says which rings belong to each polygon is empty. It must start with 0 and end with the number of rings (2).

## `polygons.ring.too_short`

- Severity: error
- Step: none
- Message: Some rings have fewer than 3 vertices, so they cannot enclose an area.
- Hint: Remove those rings or add the missing vertices.
- Example: Some rings have fewer than 3 vertices, so they cannot enclose an area.

## `polygons.ring_offsets.bad_end`

- Severity: error
- Step: none
- Message: The list that says where each ring starts must end with the number of vertices ({expected}), but it ends with {actual}.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each ring starts must end with the number of vertices (9), but it ends with 7.

## `polygons.ring_offsets.bad_start`

- Severity: error
- Step: none
- Message: The list that says where each ring starts must start with 0, but it starts with {actual}.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each ring starts must start with 0, but it starts with 1.

## `polygons.ring_offsets.decreasing`

- Severity: error
- Step: none
- Message: Some rings end before they start.
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: Some rings end before they start.

## `polygons.ring_offsets.empty`

- Severity: error
- Step: none
- Message: The list that says where each ring starts is empty. It must start with 0 and end with the number of vertices ({expected}).
- Hint: Start with 0, end with the number of vertices, and never go backwards.
- Example: The list that says where each ring starts is empty. It must start with 0 and end with the number of vertices (3).

## `table.column.length_mismatch`

- Severity: error
- Step: none
- Message: Column "{name}" has {count} values, but the first column "{first}" has {expected}.
- Hint: Make every column the same length.
- Example: Column "grade" has 1,204 values, but the first column "x" has 5.

## `table.column.name_duplicate`

- Severity: error
- Step: mapping
- Message: The column name "{name}" is used more than once.
- Hint: Give each column a different name, or ignore the extra columns.
- Example: The column name "grade" is used more than once.

## `table.column.name_empty`

- Severity: error
- Step: mapping
- Message: Column {position} has no name.
- Hint: Give the column a name, or ignore it.
- Example: Column 3 has no name.
