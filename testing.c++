
#include <bits/stdc++.h>
using namespace std;

int editDistance(const string& a, const string& b, int best) {
    int n = a.size();
    int m = b.size();

    if (abs(n - m) > best)
        return best + 1;

    vector<int> prev(m + 1), curr(m + 1);

    for (int j = 0; j <= m; ++j)
        prev[j] = j;

    for (int i = 1; i <= n; ++i) {
        curr[0] = i;
        int rowMin = curr[0];

        for (int j = 1; j <= m; ++j) {
            int cost = (a[i - 1] != b[j - 1]);

            curr[j] = min({
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost
            });

            rowMin = min(rowMin, curr[j]);
        }

        if (rowMin > best)
            return best + 1;

        swap(prev, curr);
    }

    return prev[m];
}

string findBest(const string& band, int n) {
    string answer;
    int best = INT_MAX;

    for (int i = 0; i < n; ++i) {
        string team;
        getline(cin, team);

        int d = editDistance(band, team, best);

        if (d < best) {
            best = d;
            answer = team;
        }
    }

    return answer;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    cin >> n;
    cin.ignore(numeric_limits<streamsize>::max(), '\n');

    string opening, halftime;

    getline(cin, opening);
    string afc = findBest(opening, n);

    getline(cin, halftime);
    string nfc = findBest(halftime, n);

    cout << afc << " x " << nfc << '\n';

    return 0;
}
