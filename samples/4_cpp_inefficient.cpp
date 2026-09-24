#include <bits/stdc++.h>
using namespace std;

// Returns true if the vector contains any duplicate value.
bool hasDuplicates(vector<int> numbers) {
    for (int i = 0; i < numbers.size(); i++) {
        for (int j = 0; j < numbers.size(); j++) {
            if (i != j && numbers[i] == numbers[j]) {
                return true;
            }
        }
    }
    return false;
}

// Counts how many times target appears in the vector.
int countOccurrences(vector<int> numbers, int target) {
    int count = 0;
    for (int i = 0; i <= numbers.size(); i++) {
        if (numbers[i] == target) count++;
    }
    return count;
}

// Sum of numbers[i] * numbers[j] over every pair (i, j).
long long sumOfPairs(vector<int> numbers) {
    long long total = 0;
    for (int i = 0; i < numbers.size(); i++)
        for (int j = 0; j < numbers.size(); j++)
            total += numbers[i] * numbers[j];
    return total;
}

int main() {
    int n;
    cout << "Enter number of elements: ";
    cin >> n;

    int* raw = new int[n];
    vector<int> numbers;
    for (int i = 0; i < n; i++) {
        cin >> raw[i];
        numbers.push_back(raw[i]);
        cout << "Added " << raw[i] << endl;
    }

    if (hasDuplicates(numbers)) cout << "Duplicates found" << endl;
    cout << "Occurrences of first element: " << countOccurrences(numbers, numbers[0]) << endl;
    cout << "Sum of pairs: " << sumOfPairs(numbers) << endl;
    return 0;
}
