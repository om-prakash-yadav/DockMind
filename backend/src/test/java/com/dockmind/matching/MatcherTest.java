package com.dockmind.matching;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class MatcherTest {
    private static BigDecimal n(int v) { return BigDecimal.valueOf(v); }

    @Test
    void exactQuantityMatches() {
        var r = Matcher.classify(n(80), "KG", n(80), "KG");
        assertEquals(Discrepancy.MATCH, r.discrepancy());
        assertEquals(0, r.delta().signum());
    }

    @Test
    void lessIsShortWithNegativeDelta() {
        var r = Matcher.classify(n(72), "KG", n(80), "KG");
        assertEquals(Discrepancy.SHORT, r.discrepancy());
        assertEquals(0, n(-8).compareTo(r.delta()));
    }

    @Test
    void moreIsOver() {
        assertEquals(Discrepancy.OVER, Matcher.classify(n(252), "EA", n(240), "EA").discrepancy());
    }

    @Test
    void zeroReceivedIsNotDelivered() {
        var r = Matcher.classify(BigDecimal.ZERO, "KG", n(40), "KG");
        assertEquals(Discrepancy.NOT_DELIVERED, r.discrepancy());
        assertEquals(0, n(-40).compareTo(r.delta()));
    }

    @Test
    void noOrderLineIsUnknownItem() {
        var r = Matcher.classify(n(10), "KG", null, null);
        assertEquals(Discrepancy.UNKNOWN_ITEM, r.discrepancy());
        assertNull(r.orderedQty());
    }

    @Test
    void differentUnitIsMismatchEvenWhenNumbersAgree() {
        assertEquals(Discrepancy.UNIT_MISMATCH, Matcher.classify(n(100), "CASE", n(100), "EA").discrepancy());
        assertEquals(Discrepancy.UNIT_MISMATCH, Matcher.classify(n(100), null, n(100), "EA").discrepancy());
    }

    @Test
    void unitAliasesAreNotMismatches() {
        assertEquals(Discrepancy.MATCH, Matcher.classify(n(120), "TRAYS", n(120), "TRAY").discrepancy());
        assertEquals(Discrepancy.MATCH, Matcher.classify(n(5), " kgs ", n(5), "KG").discrepancy());
    }

    @Test
    void outstandingIsOrderedMinusReceivedNeverBelowZero() {
        assertEquals(0, n(8).compareTo(Matcher.outstanding(n(80), n(72))));
        assertEquals(0, n(80).compareTo(Matcher.outstanding(n(80), null)));
        assertEquals(0, BigDecimal.ZERO.compareTo(Matcher.outstanding(n(80), n(95)))); // over-delivered earlier
        assertNull(Matcher.outstanding(null, n(5)));
    }

    @Test
    void followUpTripMatchesWhenItBringsExactlyWhatWasOutstanding() {
        var remaining = Matcher.outstanding(n(80), n(72));
        assertEquals(Discrepancy.MATCH, Matcher.classify(n(8), "KG", remaining, "KG").discrepancy());
        assertEquals(Discrepancy.OVER, Matcher.classify(n(10), "KG", remaining, "KG").discrepancy());
        assertEquals(Discrepancy.SHORT, Matcher.classify(n(5), "KG", remaining, "KG").discrepancy());
    }

    @Test
    void descriptionsMatchWhenOneIsAShortening() {
        assertTrue(Matcher.descriptionsOverlap("Cheddar", "Cheddar, mature"));
        assertFalse(Matcher.descriptionsOverlap("Scallops", "Tiger Prawns"));
    }

    @Test
    void supplierMustAgreeWithPo() {
        assertTrue(Matcher.suppliersAgree("Blue Ocean Seafood Co.", "Blue Ocean Seafood Co."));
        assertTrue(Matcher.suppliersAgree("Fresh Farm Produce", "Fresh Farm Produce Ltd"));
        assertFalse(Matcher.suppliersAgree("Green Valley Eggs", "Dairy Direct"));
        assertTrue(Matcher.suppliersAgree(null, "Dairy Direct"));
    }
}
