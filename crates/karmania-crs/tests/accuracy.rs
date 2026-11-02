//! How accurate the conversions are, against values published by someone else.
//!
//! No copy of PROJ or pyproj was on the machine, so the references are the worked examples of
//! the EPSG Guidance Note 7-2 ("Coordinate Conversions and Transformations including Formulas",
//! OGP, November 2009, 120 pages), which print a geographic position and the projected position
//! it gives. The copy read is the one in the NetBSD `pkgsrc` distfiles
//! (`epsg-docs-200911/G7-2.pdf`, SHA-256
//! `816176d099f1aaee72135605eed279a92c7f5a329d8452eea29b736879792a59`); it is not IOGP's current
//! edition, which was not available to read.
//!
//! The brief asks for 1 mm on projected positions and 1e-9 degrees on geographic ones. A value
//! printed with two decimals can only be checked to half of a hundredth of a metre, so each row
//! carries the tolerance its source allows, and says why where that is more than 5 mm. The round
//! trips, which have no such limit, are held to the brief's tolerances.

use karmania_core::CrsRef;
use karmania_crs::Transformer;

fn epsg(code: u32) -> CrsRef {
    CrsRef::Epsg { code }
}

/// Degrees from degrees, minutes and seconds, with the sign given apart so that 0 degrees can be
/// west or south.
fn dms(sign: f64, degrees: f64, minutes: f64, seconds: f64) -> f64 {
    sign * (degrees + minutes / 60.0 + seconds / 3600.0)
}

struct Row {
    name: &'static str,
    /// Where the numbers are printed.
    source: &'static str,
    /// The geographic system and the projected system of the example.
    geographic: u32,
    projected: u32,
    lon: f64,
    lat: f64,
    easting: f64,
    northing: f64,
    /// How far a result may be from the printed one, in metres: half of the last printed digit,
    /// or more where the note says why.
    tolerance: f64,
    note: &'static str,
}

fn rows() -> Vec<Row> {
    let world = |name, source, lat: f64, northing: f64, code, note| Row {
        name,
        source,
        geographic: 4326,
        projected: code,
        lon: dms(-1.0, 100.0, 20.0, 0.0),
        lat,
        easting: -11_169_055.58,
        northing,
        tolerance: 0.005,
        note,
    };
    let (top, bottom) = (dms(1.0, 24.0, 27.0, 48.889), dms(1.0, 24.0, 22.0, 54.433));
    vec![
        Row {
            name: "OSGB 1936 / British National Grid",
            source: "GN7-2 section 1.3.5.1, page 40 (Transverse Mercator)",
            geographic: 4277,
            projected: 27_700,
            lon: dms(1.0, 0.0, 30.0, 0.0),
            lat: dms(1.0, 50.0, 30.0, 0.0),
            easting: 577_274.99,
            northing: 69_740.50,
            tolerance: 0.010,
            note: "the printed value is 6.2 mm and 7.7 mm from 577274.9838 and 69740.4923, which \
                   proj4rs, the series printed in GN7-2 and Karney's exact series all give \
                   (checked once in a separate script): its intermediate values are rounded",
        },
        Row {
            name: "Belge 1972 / Belge Lambert 72",
            source: "GN7-2 section 1.3.1.4, pages 24 and 25 (Lambert Conic Conformal 2SP)",
            geographic: 4313,
            projected: 31_370,
            lon: dms(1.0, 5.0, 48.0, 26.533),
            lat: dms(1.0, 50.0, 40.0, 46.461),
            easting: 251_763.20,
            northing: 153_034.13,
            tolerance: 0.060,
            note: "the definitions have standard parallels 0.00204 arc seconds more than the \
                   example's, a later revision, which moves the northing by 46 mm; with the \
                   example's own parallels the difference was 2.8 mm (tried once with a PROJ \
                   string built by hand)",
        },
        Row {
            name: "JAD69 / Jamaica National Grid",
            source: "GN7-2 section 1.3.1.2, page 23 (Lambert Conic Conformal 1SP)",
            geographic: 4242,
            projected: 24_200,
            lon: dms(-1.0, 76.0, 56.0, 37.26),
            lat: dms(1.0, 17.0, 55.0, 55.80),
            easting: 255_966.58,
            northing: 142_493.51,
            tolerance: 0.005,
            note: "",
        },
        Row {
            name: "Pulkovo 1942 / Mercator Caspian Sea",
            source: "GN7-2 section 1.3.3, page 31, example 1 (Mercator with two standard parallels)",
            geographic: 4284,
            projected: 3388,
            lon: 53.0,
            lat: 53.0,
            easting: 165_704.29,
            northing: 5_171_848.07,
            tolerance: 0.005,
            note: "",
        },
        Row {
            name: "Makassar / NEIEZ",
            source: "GN7-2 section 1.3.3, pages 31 and 32, example 2 (Mercator 1SP)",
            geographic: 4257,
            projected: 3002,
            lon: 120.0,
            lat: -3.0,
            easting: 5_009_726.58,
            northing: 569_150.82,
            tolerance: 0.005,
            note: "",
        },
        world(
            "WGS 84 / Pseudo-Mercator, 24°22'54.433\"N",
            "GN7-2 section 1.3.3.2, page 34",
            bottom,
            2_800_000.00,
            3857,
            "",
        ),
        world(
            "WGS 84 / Pseudo-Mercator, 24°27'48.889\"N",
            "GN7-2 section 1.3.3.2, page 34 (the table at its end)",
            top,
            2_810_000.00,
            3857,
            "",
        ),
        world(
            "WGS 84 / World Mercator, 24°27'48.889\"N",
            "GN7-2 section 1.3.3.2, page 34 (the table at its end)",
            top,
            2_792_311.49,
            3395,
            "",
        ),
        world(
            "WGS 84 / World Mercator, 24°22'54.433\"N",
            "GN7-2 section 1.3.3.2, page 34 (the table at its end)",
            bottom,
            2_782_367.06,
            3395,
            "",
        ),
        Row {
            name: "Amersfoort / RD New",
            source: "GN7-2 section 1.3.7.1, page 52 (Oblique Stereographic)",
            geographic: 4289,
            projected: 28_992,
            lon: 6.0,
            lat: 53.0,
            easting: 196_105.283,
            northing: 557_057.739,
            tolerance: 0.001,
            note: "printed to three decimals, the only example here that can be held to 1 mm",
        },
        Row {
            name: "WGS 84 / UPS North",
            source: "GN7-2 section 1.3.7.2, page 55 (Polar Stereographic variant A)",
            geographic: 4326,
            projected: 32_661,
            lon: 44.0,
            lat: 73.0,
            easting: 3_320_416.75,
            northing: 632_668.43,
            tolerance: 0.005,
            note: "",
        },
        Row {
            name: "ETRS89 / ETRS-LAEA",
            source: "GN7-2 section 1.3.11, pages 61 and 62 (Lambert Azimuthal Equal Area)",
            geographic: 4258,
            projected: 3035,
            lon: 5.0,
            lat: 50.0,
            easting: 3_962_799.45,
            northing: 2_999_718.85,
            tolerance: 0.005,
            note: "",
        },
    ]
}

fn transformer(from: u32, to: u32) -> Result<Transformer, String> {
    Transformer::new(epsg(from), epsg(to))
        .map_err(|finding| format!("EPSG:{from} to EPSG:{to}: {}", finding.message))
}

#[test]
fn the_published_geographic_positions_give_the_published_projected_ones() -> Result<(), String> {
    for row in rows() {
        let [x, y] = transformer(row.geographic, row.projected)?.convert(row.lon, row.lat);
        let (de, dn) = (x - row.easting, y - row.northing);
        assert!(
            de.abs() <= row.tolerance && dn.abs() <= row.tolerance,
            "{} ({}): easting off by {de:+.4} m, northing by {dn:+.4} m, allowed {} m. {}",
            row.name,
            row.source,
            row.tolerance,
            row.note
        );
    }
    Ok(())
}

#[test]
fn the_published_projected_positions_give_the_published_geographic_ones() -> Result<(), String> {
    for row in rows() {
        // The input is the printed, rounded easting and northing, so the result may be as far
        // from the printed position as the printed digits allow: a metre is this many degrees.
        let [lon, lat] =
            transformer(row.projected, row.geographic)?.convert(row.easting, row.northing);
        let metres_per_degree = 111_320.0;
        let lon_tolerance = row.tolerance / (metres_per_degree * row.lat.to_radians().cos());
        let lat_tolerance = row.tolerance / (metres_per_degree * 0.99);
        assert!(
            (lon - row.lon).abs() <= lon_tolerance && (lat - row.lat).abs() <= lat_tolerance,
            "{} ({}): longitude off by {:+.2e} degrees (allowed {lon_tolerance:.2e}), latitude by {:+.2e} (allowed {lat_tolerance:.2e}). {}",
            row.name,
            row.source,
            lon - row.lon,
            lat - row.lat,
            row.note
        );
    }
    Ok(())
}

/// Systems to go round: the geographic one, the projected one, and the area of the projection as
/// a range of longitudes and a range of latitudes, crossed in 25 steps each way.
const AREAS: [(u32, u32, [f64; 2], [f64; 2]); 11] = [
    (4326, 32_640, [54.0, 60.0], [-10.0, 70.0]),
    (4326, 32_718, [-78.0, -72.0], [-79.0, -1.0]),
    (4326, 3857, [-179.0, 179.0], [-84.0, 84.0]),
    (4326, 3395, [-179.0, 179.0], [-79.0, 83.0]),
    (4258, 3035, [-10.0, 35.0], [35.0, 70.0]),
    (4289, 28_992, [3.0, 8.0], [50.5, 53.8]),
    (4277, 27_700, [-7.0, 1.8], [50.0, 60.5]),
    (4326, 2229, [-121.0, -115.0], [32.0, 36.0]),
    (4326, 32_661, [-180.0, 180.0], [60.0, 89.5]),
    (4313, 31_370, [2.6, 6.3], [49.6, 51.4]),
    (4284, 3388, [46.0, 56.0], [37.0, 56.0]),
];

#[test]
fn going_to_a_projected_system_and_back_gives_the_position_again_to_a_nanodegree()
-> Result<(), String> {
    for (geographic, projected, [lon0, lon1], [lat0, lat1]) in AREAS {
        let (forward, back) = (
            transformer(geographic, projected)?,
            transformer(projected, geographic)?,
        );
        let mut worst: f64 = 0.0;
        for i in 0..=24 {
            for j in 0..=24 {
                let lon = lon0 + (lon1 - lon0) * f64::from(i) / 24.0;
                let lat = lat0 + (lat1 - lat0) * f64::from(j) / 24.0;
                let [x, y] = forward.convert(lon, lat);
                let [lon2, lat2] = back.convert(x, y);
                // The longitude is the same place however it is written, and is wrapped by some
                // systems; only the difference modulo 360 degrees counts.
                let dlon = (lon2 - lon + 180.0).rem_euclid(360.0) - 180.0;
                worst = worst
                    .max(dlon.abs() * lat.to_radians().cos())
                    .max((lat2 - lat).abs());
            }
        }
        assert!(
            worst < 1e-9,
            "EPSG:{geographic} to EPSG:{projected} and back: worst difference {worst:.3e} degrees"
        );
    }
    Ok(())
}

#[test]
fn going_from_a_projected_system_and_back_gives_the_position_again_to_a_millimetre()
-> Result<(), String> {
    for (geographic, projected, [lon0, lon1], [lat0, lat1]) in AREAS {
        let (forward, back) = (
            transformer(geographic, projected)?,
            transformer(projected, geographic)?,
        );
        let mut worst: f64 = 0.0;
        for i in 0..=24 {
            for j in 0..=24 {
                let lon = lon0 + (lon1 - lon0) * f64::from(i) / 24.0;
                let lat = lat0 + (lat1 - lat0) * f64::from(j) / 24.0;
                let [x, y] = forward.convert(lon, lat);
                let [lon2, lat2] = back.convert(x, y);
                let [x2, y2] = forward.convert(lon2, lat2);
                worst = worst.max((x2 - x).abs()).max((y2 - y).abs());
            }
        }
        assert!(
            worst < 1e-3,
            "EPSG:{projected} to EPSG:{geographic} and back: worst difference {worst:.3e} m"
        );
    }
    Ok(())
}
