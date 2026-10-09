import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.List;

/**
 * Minimal apksigner replacement built on Google's apksig library.
 *
 * <pre>
 * ApkTool verify &lt;apk&gt;
 * ApkTool sign &lt;in.apk&gt; &lt;out.apk&gt; &lt;keystore&gt; &lt;password&gt; &lt;alias&gt;
 * </pre>
 */
public class ApkTool {
  public static void main(String[] a) throws Exception {
    if (a.length == 2 && a[0].equals("verify")) {
      ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[1])).build().verify();
      System.out.println("verified=" + r.isVerified() + " v2=" + r.isVerifiedUsingV2Scheme());
      for (X509Certificate c : r.getSignerCertificates()) {
        System.out.println("signer: " + c.getSubjectX500Principal());
      }
      for (Object e : r.getErrors()) System.out.println("error: " + e);
      System.exit(r.isVerified() ? 0 : 1);
    }
    if (a.length != 6 || !a[0].equals("sign")) {
      System.err.println("usage: ApkTool verify <apk> | sign <in> <out> <keystore> <password> <alias>");
      System.exit(2);
    }
    // Detects JKS or PKCS12, so ~/.android/debug.keystore works too.
    KeyStore ks = KeyStore.getInstance(new File(a[3]), a[4].toCharArray());
    PrivateKey key = (PrivateKey) ks.getKey(a[5], a[4].toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate(a[5]);
    ApkSigner.SignerConfig signer =
        new ApkSigner.SignerConfig.Builder("CERT", key, List.of(cert)).build();
    // v2 only, like the original debug build (v1 needs a JDK API removed in Java 17+).
    new ApkSigner.Builder(List.of(signer))
        .setV1SigningEnabled(false)
        .setV2SigningEnabled(true)
        .setInputApk(new File(a[1]))
        .setOutputApk(new File(a[2]))
        .build()
        .sign();
  }
}
