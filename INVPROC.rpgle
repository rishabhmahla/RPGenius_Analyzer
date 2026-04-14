**FREE
// =============================================================================
// Program  : INVPROC
// Purpose  : Invoice Processing — Free Format RPGLE with Embedded SQL
// =============================================================================

Ctl-Opt DftActGrp(*No) ActGrp('INVPROC') Option(*SrcStmt);

// ── File Declarations ─────────────────────────────────────────────────────────
DCL-F INVHDR  Usage(*Input : *Update) Keyed;
DCL-F INVDET  Usage(*Input)           Keyed;
DCL-F CUSTMST Usage(*Input)           Keyed;
DCL-F ITMMST  Usage(*Input)           Keyed;
DCL-F INVOUT  Usage(*Output)          PRINTER;
DCL-F INVWRK  Usage(*Input : *Output) WORKSTN;

// ── Copybooks ─────────────────────────────────────────────────────────────────
/COPY QRPGLESRC,INVCPY
/COPY QRPGLESRC,SQLCA
/COPY COMMONLIB,ERRSUB

// ── Prototypes ────────────────────────────────────────────────────────────────
DCL-PR CalcTax ExtPgm('TAXCALC');
  PR_Amount   Packed(13:2) Const;
  PR_State    Char(2)      Const;
  PR_TaxAmt   Packed(13:2);
End-PR;

DCL-PR PostToGL ExtPgm('GLPOST');
  PR_Amount   Packed(13:2) Const;
  PR_Account  Char(10)     Const;
  PR_Ref      Char(20)     Const;
End-PR;

DCL-PR LogEvent ExtProc('logEventProc');
  PR_EventType Char(10) Const;
  PR_Message   Char(200) Const;
End-PR;

// ── Data Structures ───────────────────────────────────────────────────────────
DCL-DS InvKey Qualified;
  InvoiceNo Packed(9:0);
  LineNo    Packed(3:0);
End-DS;

DCL-DS CustInfo LikeDS(CUSTMST_T) Template;

DCL-DS TaxBreakdown Qualified;
  FedTax   Packed(13:2);
  StateTax Packed(13:2);
  LocalTax Packed(13:2);
  Total    Packed(13:2);
End-DS;

DCL-DS SqlHostVars;
  HvInvNo    Packed(9:0);
  HvCustNo   Char(10);
  HvTotal    Packed(13:2);
  HvStatus   Char(2);
End-DS;

// ── Standalone Variables ──────────────────────────────────────────────────────
DCL-S WsInvTotal   Packed(13:2);
DCL-S WsTaxAmt     Packed(13:2);
DCL-S WsNetAmt     Packed(13:2);
DCL-S WsCustName   Char(40);
DCL-S WsErrMsg     Char(100);
DCL-S WsProcessed  Int(3) Inz(0);
DCL-S WsErrors     Int(3) Inz(0);

// ── Constants ─────────────────────────────────────────────────────────────────
DCL-C DEFAULT_TAX  0.0825;
DCL-C STATUS_OPEN  'OP';
DCL-C STATUS_PAID  'PD';
DCL-C STATUS_VOID  'VD';
DCL-C GL_REVENUE   '4000-000';
DCL-C GL_TAX       '2200-100';

// =============================================================================
// MAIN
// =============================================================================

EXEC SQL
  DECLARE InvCursor CURSOR WITH HOLD FOR
  SELECT INV_NO, CUST_NO, INV_TOTAL, INV_STATUS
  FROM   INVHDR
  WHERE  INV_STATUS = 'OP'
    AND  INV_DATE <= CURRENT_DATE
  ORDER BY INV_DATE;

EXEC SQL OPEN InvCursor;

EXEC SQL
  FETCH NEXT FROM InvCursor
  INTO :HvInvNo, :HvCustNo, :HvTotal, :HvStatus;

DoW SQLCODE = 0;
  WsInvTotal = HvTotal;

  // Validate customer
  If Not ValidateAndLoad(HvCustNo);
    EXEC SQL
      UPDATE INVHDR
      SET    INV_STATUS = 'ER'
      WHERE  INV_NO = :HvInvNo;

    WsErrors += 1;
  Else;
    // Calculate tax
    CalcTax(WsInvTotal : CUST_STATE : WsTaxAmt);
    WsNetAmt = WsInvTotal + WsTaxAmt;

    // Post to GL
    PostToGL(WsNetAmt : GL_REVENUE : %Char(HvInvNo));
    PostToGL(WsTaxAmt : GL_TAX     : %Char(HvInvNo));

    // Mark as processed
    EXEC SQL
      UPDATE INVHDR
      SET    INV_STATUS  = 'PD',
             INV_TAXAMT  = :WsTaxAmt,
             INV_NETAMT  = :WsNetAmt,
             INV_PROCDT  = CURRENT_DATE
      WHERE  INV_NO = :HvInvNo;

    WsProcessed += 1;
    LogEvent('INVPROC' : 'Processed invoice ' + %Char(HvInvNo));
  EndIf;

  EXEC SQL
    FETCH NEXT FROM InvCursor
    INTO :HvInvNo, :HvCustNo, :HvTotal, :HvStatus;
EndDo;

EXEC SQL CLOSE InvCursor;

CALLP PostSummaryReport(WsProcessed : WsErrors);

*InLR = *On;
Return;

// =============================================================================
// PROCEDURE: ValidateAndLoad
// Validates customer exists and is active; loads customer data into WsCustName
// =============================================================================
DCL-PROC ValidateAndLoad;
  DCL-PI ValidateAndLoad Ind;
    PI_CustNo Char(10) Const;
  End-PI;

  Chain PI_CustNo CUSTMST;
  If Not %Found(CUSTMST);
    WsErrMsg = 'Customer not found: ' + %Trim(PI_CustNo);
    Return *Off;
  EndIf;

  If CUST_STATUS <> 'A';
    WsErrMsg = 'Customer is inactive: ' + %Trim(PI_CustNo);
    Return *Off;
  EndIf;

  WsCustName = CUST_NAME;
  Return *On;
End-Proc ValidateAndLoad;

// =============================================================================
// PROCEDURE: PostSummaryReport
// Writes a summary to the printer file
// =============================================================================
DCL-PROC PostSummaryReport;
  DCL-PI PostSummaryReport;
    PI_Processed Int(3) Const;
    PI_Errors    Int(3) Const;
  End-PI;

  // Write header line
  Write INVOUTHDR;

  // Write summary line
  RPT_PROCESSED = PI_Processed;
  RPT_ERRORS    = PI_Errors;
  RPT_DATE      = %Date();
  Write INVOUTSUMM;

End-Proc PostSummaryReport;

// =============================================================================
// PROCEDURE: CalcTaxBreakdown
// Returns a qualified DS with federal, state, and local tax components
// =============================================================================
DCL-PROC CalcTaxBreakdown Export;
  DCL-PI CalcTaxBreakdown LikeDS(TaxBreakdown);
    PI_Amount  Packed(13:2) Const;
    PI_State   Char(2)      Const;
    PI_Country Char(3)      Const Value;
  End-PI;

  DCL-DS Result LikeDS(TaxBreakdown);

  Result.FedTax   = PI_Amount * 0.0200;
  Result.StateTax = PI_Amount * DEFAULT_TAX;
  Result.LocalTax = PI_Amount * 0.0025;
  Result.Total    = Result.FedTax + Result.StateTax + Result.LocalTax;

  Return Result;
End-Proc CalcTaxBreakdown;
