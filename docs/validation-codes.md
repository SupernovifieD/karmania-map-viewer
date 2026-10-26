# Validation codes

Every finding code, with its severity, the wizard step that can fix it, its
message template, its hint and an example. Codes are stable: never rename one or
change its meaning; add a new code instead. Sections are sorted by code.

A unit test in `karmania-core` fails if a registered code is missing here, if its
severity or step disagrees with the registry, or if this file lists a code that
is not registered. In message templates, `{name}` marks a value filled in at
runtime. Numbers in messages use thousands separators (1,203).

## `blocks.ijk.duplicate`

- Severity: error
- Step: none
- Message: Some blocks are listed more than once.
- Hint: List each block once.
- Example: Some blocks are listed more than once.

## `blocks.ijk.incomplete`

- Severity: error
- Step: none
- Message: The list of block positions ends with an incomplete triplet: it has {count} numbers, which is not a multiple of 3.
- Hint: Give three numbers (i, j, k) for every block.
- Example: The list of block positions ends with an incomplete triplet: it has 5 numbers, which is not a multiple of 3.

## `blocks.ijk.out_of_range`

- Severity: error
- Step: none
- Message: Some blocks are outside the model, which has {nx} x {ny} x {nz} cells.
- Hint: Block positions start at 0 and must be lower than the number of cells on each axis.
- Example: Some blocks are outside the model, which has 2 x 3 x 4 cells.

## `crs.epsg.unknown`

- Severity: error
- Step: crs
- Message: The EPSG code {code} is not in the list of coordinate systems this tool knows.
- Hint: Check the code. For example, 4326 is WGS 84 and 32640 is WGS 84 / UTM zone 40N.
- Example: The EPSG code 99999 is not in the list of coordinate systems this tool knows.

## `crs.geographic.axes_swapped`

- Severity: warning
- Step: crs
- Message: X and Y may be swapped: X runs from {min_x} to {max_x}, which fits latitude, and Y runs from {min_y} to {max_y}, which does not.
- Hint: In a longitude and latitude system, X is longitude and Y is latitude. Swap the two columns in the mapping step.
- Example: X and Y may be swapped: X runs from -33.9 to 25.2, which fits latitude, and Y runs from 121.5 to 151.2, which does not.

## `crs.geographic.out_of_range`

- Severity: warning
- Step: crs
- Message: Some coordinates are not valid longitudes and latitudes: X runs from {min_x} to {max_x} and Y from {min_y} to {max_y}, but longitude must be between -180 and 360 and latitude between -90 and 90.
- Hint: Check the coordinate system. Values this large usually belong to a projected system such as UTM.
- Example: Some coordinates are not valid longitudes and latitudes: X runs from 500000 to 510000 and Y from 2800000 to 2810000, but longitude must be between -180 and 360 and latitude between -90 and 90.

## `crs.missing`

- Severity: error
- Step: crs
- Message: The coordinate reference system is missing, so the positions have no meaning on the Earth.
- Hint: Choose an EPSG code, or choose a local grid and its units.
- Example: The coordinate reference system is missing, so the positions have no meaning on the Earth.

## `crs.projected.implausible`

- Severity: warning
- Step: crs
- Message: Some coordinates do not fit EPSG:{code} ({name}): they cannot be converted to valid longitudes and latitudes.
- Hint: Check that you chose the right coordinate system, for example the right UTM zone and hemisphere, and that X is the easting and Y the northing.
- Example: Some coordinates do not fit EPSG:32640 (WGS 84 / UTM zone 40N): they cannot be converted to valid longitudes and latitudes.

## `crs.projected.outside_zone`

- Severity: warning
- Step: crs
- Message: Some coordinates are more than 9 degrees of longitude from the middle of UTM zone {zone} (EPSG:{code}), so they probably belong to another zone or coordinate system.
- Hint: Each UTM zone is 6 degrees wide. Find the zone for your area and choose its EPSG code, for example 32640 for zone 40 north or 32740 for zone 40 south.
- Example: Some coordinates are more than 9 degrees of longitude from the middle of UTM zone 40 (EPSG:32640), so they probably belong to another zone or coordinate system.

## `crs.projected.unchecked`

- Severity: info
- Step: none
- Message: The coordinates could not be checked against EPSG:{code} ({name}) because this tool cannot calculate that projection.
- Hint: none
- Example: The coordinates could not be checked against EPSG:3993 (NAD83(NSRS2007) / Guam Dateline) because this tool cannot calculate that projection.

## `csv.coordinate.missing`

- Severity: error
- Step: nodata
- Message: Some rows have an empty or unreadable value in the coordinate column "{name}".
- Hint: Fix those rows, or choose to skip rows with an empty coordinate.
- Example: Some rows have an empty or unreadable value in the coordinate column "Easting".

## `csv.rows.ragged`

- Severity: warning
- Step: file
- Message: Some rows have a different number of values from the header ({count}); missing values were left empty and extra ones ignored.
- Hint: Check the delimiter, and the file for stray line breaks and quotes.
- Example: Some rows have a different number of values from the header (6); missing values were left empty and extra ones ignored.

## `csv.rows.skipped`

- Severity: warning
- Step: nodata
- Message: Some rows were left out because a coordinate was empty or unreadable.
- Hint: Check the file if you expected every row to be used.
- Example: Some rows were left out because a coordinate was empty or unreadable.

## `csv.value.unreadable`

- Severity: warning
- Step: mapping
- Message: Some values in the column "{name}" could not be read as {type}, so they were left empty.
- Hint: Check the column's type, or the values you marked as no data.
- Example: Some values in the column "Au" could not be read as float, so they were left empty.

## `dataset.attributes.rows_mismatch`

- Severity: error
- Step: none
- Message: The attribute table has {rows} rows, but the dataset has {count} {things}.
- Hint: Give every one of the {things} exactly one value in each column.
- Example: The attribute table has 5 rows, but the dataset has 3 points.

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

## `dataset.vertex_attributes.rows_mismatch`

- Severity: error
- Step: none
- Message: The per-vertex table has {rows} rows, but the dataset has {count} vertices.
- Hint: Give every vertex exactly one value in each column.
- Example: The per-vertex table has 3 rows, but the dataset has 4 vertices.

## `dataset.vertex_attributes.unsupported`

- Severity: warning
- Step: none
- Message: Per-vertex attributes are only used for lines and meshes, so they are ignored for {things}.
- Hint: Move those values to the attribute table, or remove them.
- Example: Per-vertex attributes are only used for lines and meshes, so they are ignored for points.

## `file.empty`

- Severity: error
- Step: file
- Message: The file has no data in it.
- Hint: Check that you chose the right file.
- Example: The file has no data in it.

## `file.encoding.fallback`

- Severity: warning
- Step: file
- Message: The file is not valid UTF-8, so it was read as Windows-1252 (Western European text). Letters with accents may look wrong if it uses a different encoding.
- Hint: Save the file as UTF-8 and import it again.
- Example: The file is not valid UTF-8, so it was read as Windows-1252 (Western European text). Letters with accents may look wrong if it uses a different encoding.

## `file.encoding.invalid_utf16`

- Severity: warning
- Step: file
- Message: Some UTF-16 characters could not be read and were replaced with a question-mark symbol.
- Hint: Save the file as UTF-8 and import it again.
- Example: Some UTF-16 characters could not be read and were replaced with a question-mark symbol.

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

## `mapping.block_size.invalid`

- Severity: error
- Step: mapping
- Message: The block size must be greater than 0 in all three directions, but it is {dx} x {dy} x {dz}.
- Hint: Use positive numbers, such as 10 for 10-metre blocks.
- Example: The block size must be greater than 0 in all three directions, but it is 10 x 0 x 5.

## `mapping.block_size.missing`

- Severity: error
- Step: mapping
- Message: The block size is missing.
- Hint: Enter the size of a block along X, Y and Z.
- Example: The block size is missing.

## `mapping.coordinate.missing`

- Severity: error
- Step: mapping
- Message: No column is set as {X (easting or longitude), Y (northing or latitude) or Z (elevation)}.
- Hint: Choose the column that holds this coordinate.
- Example: No column is set as X (easting or longitude).

## `mapping.coordinate.not_numeric`

- Severity: error
- Step: mapping
- Message: The column "{name}" is set as {X, Y or Z} but its type is {type}; coordinates must be numbers.
- Hint: Set the column's type to float or int, or choose another column.
- Example: The column "E" is set as X (easting or longitude) but its type is text; coordinates must be numbers.

## `mapping.kind.unsupported`

- Severity: error
- Step: file
- Message: A CSV file can be imported as points, lines or a block model, not as {kind}.
- Hint: Choose points, lines or a block model.
- Example: A CSV file can be imported as points, lines or a block model, not as grid.

## `mapping.line_id.missing`

- Severity: error
- Step: mapping
- Message: No column is set as the line identifier, so rows cannot be grouped into lines.
- Hint: Choose the column that says which line each row belongs to.
- Example: No column is set as the line identifier, so rows cannot be grouped into lines.

## `mapping.role.duplicate`

- Severity: error
- Step: mapping
- Message: More than one column is set as {role}.
- Hint: Keep one column for this role and set the others to attribute or ignore.
- Example: More than one column is set as X (easting or longitude).

## `mapping.source.duplicate`

- Severity: error
- Step: mapping
- Message: The column "{name}" is mapped more than once.
- Hint: Give each column of the file one role.
- Example: The column "N" is mapped more than once.

## `mapping.source.unknown`

- Severity: error
- Step: mapping
- Message: The mapping refers to a column that is not in the file: "{name}".
- Hint: Check the column names, or map the columns again.
- Example: The mapping refers to a column that is not in the file: "Au".

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

## `table.column.all_null`

- Severity: warning
- Step: nodata
- Message: The {column or per-vertex column} "{name}" has no values: every entry is empty.
- Hint: Ignore this column, or check which values you marked as no data.
- Example: The column "ag" has no values: every entry is empty.

## `table.column.category_out_of_range`

- Severity: error
- Step: none
- Message: Some values in the {column or per-vertex column} "{name}" refer to categories that do not exist.
- Hint: Every category code must point at one of the listed category names.
- Example: Some values in the column "rock" refer to categories that do not exist.

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

## `values.coordinates.not_finite`

- Severity: error
- Step: none
- Message: Some coordinates are not valid numbers (empty, NaN or infinite), so those positions cannot be placed on a map.
- Hint: Fix or remove those rows.
- Example: Some coordinates are not valid numbers (empty, NaN or infinite), so those positions cannot be placed on a map.

## `values.coordinates.very_large`

- Severity: warning
- Step: none
- Message: Some coordinates are larger than 100,000,000. The units may be wrong, for example millimetres instead of metres.
- Hint: Check the units of the coordinates and the coordinate system you chose.
- Example: Some coordinates are larger than 100,000,000. The units may be wrong, for example millimetres instead of metres.

## `values.points.duplicate`

- Severity: warning
- Step: none
- Message: Some points are repeated at exactly the same position.
- Hint: Remove the repeated points if they are mistakes.
- Example: Some points are repeated at exactly the same position.
